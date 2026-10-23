import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { extractTemplateStructure, InvalidTemplateFileError } from './extract';

/**
 * Builds a real .xlsx workbook in memory and returns its bytes, so the
 * extractor is exercised against genuine ExcelJS output rather than mocks.
 */
async function buildWorkbook(
  sheets: Array<{
    name: string;
    fill?: { row: number; col: number; value: string }[];
    merges?: string[];
  }>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name);
    for (const cell of sheet.fill ?? []) {
      ws.getCell(cell.row, cell.col).value = cell.value;
    }
    for (const range of sheet.merges ?? []) {
      ws.mergeCells(range);
    }
  }
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

describe('extractTemplateStructure', () => {
  it('extracts every sheet, in order, with its name', async () => {
    const bytes = await buildWorkbook([
      { name: 'MU1' },
      { name: 'dryhandling1' },
      { name: 'Description' },
    ]);

    const structure = await extractTemplateStructure(bytes);

    expect(structure.sheets.map((s) => s.name)).toEqual([
      'MU1',
      'dryhandling1',
      'Description',
    ]);
    expect(structure.sheets.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it('reports row/column dimensions from used cells', async () => {
    const bytes = await buildWorkbook([
      {
        name: 'Data',
        fill: [
          { row: 1, col: 1, value: 'a' },
          { row: 3, col: 4, value: 'b' }, // extends used range to row 3, col 4
        ],
      },
    ]);

    const [sheet] = (await extractTemplateStructure(bytes)).sheets;

    expect(sheet.rowCount).toBe(3);
    expect(sheet.columnCount).toBe(4);
  });

  it('captures merged ranges in A1 notation', async () => {
    const bytes = await buildWorkbook([
      {
        name: 'Merged',
        fill: [{ row: 1, col: 1, value: 'title' }],
        merges: ['A1:D1', 'B3:C4'],
      },
    ]);

    const [sheet] = (await extractTemplateStructure(bytes)).sheets;

    expect(sheet.mergedRanges).toEqual(['A1:D1', 'B3:C4']);
  });

  it('accepts Uint8Array and ArrayBuffer inputs', async () => {
    const buf = await buildWorkbook([{ name: 'S1' }]);

    const fromUint8 = await extractTemplateStructure(new Uint8Array(buf));
    const copy = new Uint8Array(buf.byteLength);
    copy.set(buf);
    const arrayBuffer: ArrayBuffer = copy.buffer;
    const fromArrayBuffer = await extractTemplateStructure(arrayBuffer);

    expect(fromUint8.sheets[0].name).toBe('S1');
    expect(fromArrayBuffer.sheets[0].name).toBe('S1');
  });

  it('rejects an empty file with a descriptive error', async () => {
    await expect(extractTemplateStructure(Buffer.alloc(0))).rejects.toThrow(
      InvalidTemplateFileError,
    );
    await expect(extractTemplateStructure(Buffer.alloc(0))).rejects.toThrow(/empty/i);
  });

  it('rejects a non-xlsx (plain text) file with a descriptive error', async () => {
    const notXlsx = Buffer.from('this is clearly not a spreadsheet', 'utf8');

    await expect(extractTemplateStructure(notXlsx)).rejects.toThrow(InvalidTemplateFileError);
    await expect(extractTemplateStructure(notXlsx)).rejects.toThrow(/\.xlsx/);
  });

  it('rejects a corrupt zip that is not a real workbook', async () => {
    // Starts with the ZIP signature (passes the cheap check) but is not a
    // valid workbook, so the parser must reject it.
    const fakeZip = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('garbage payload not a real xlsx', 'utf8'),
    ]);

    await expect(extractTemplateStructure(fakeZip)).rejects.toThrow(InvalidTemplateFileError);
  });
});
