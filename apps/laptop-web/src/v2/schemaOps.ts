// Pure Template_Schema edits for the Template Studio (R3.3). Every function
// returns a new schema; parameter `order` is renumbered per category.

import {
  orderedCategories,
  parametersIn,
  slugId,
  type ParameterDef,
  type TemplateSchema,
} from '@rnh/shared/v2';

function renumber(params: ParameterDef[]): ParameterDef[] {
  const counters = new Map<string, number>();
  return params.map((p) => {
    const n = counters.get(p.categoryId) ?? 0;
    counters.set(p.categoryId, n + 1);
    return { ...p, order: n };
  });
}

/** Parameters in display order (category order, then parameter order). */
function flat(schema: TemplateSchema): ParameterDef[] {
  return orderedCategories(schema).flatMap((c) => parametersIn(schema, c.categoryId));
}

function withParams(schema: TemplateSchema, params: ParameterDef[]): TemplateSchema {
  return { ...schema, parameters: renumber(params) };
}

export function patchParam(
  schema: TemplateSchema,
  paramId: string,
  change: Partial<ParameterDef>,
): TemplateSchema {
  const list = flat(schema).map((p) => (p.paramId === paramId ? { ...p, ...change } : p));
  // A category change moves the parameter to the end of its new category.
  if (change.categoryId) {
    const i = list.findIndex((p) => p.paramId === paramId);
    const [moved] = list.splice(i, 1);
    list.push(moved);
    return withParams(
      schema,
      orderedCategories(schema).flatMap((c) => list.filter((p) => p.categoryId === c.categoryId)),
    );
  }
  return withParams(schema, list);
}

export function moveParam(schema: TemplateSchema, paramId: string, delta: -1 | 1): TemplateSchema {
  const list = flat(schema);
  const i = list.findIndex((p) => p.paramId === paramId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length || list[i].categoryId !== list[j].categoryId)
    return schema;
  [list[i], list[j]] = [list[j], list[i]];
  return withParams(schema, list);
}

export function removeParam(schema: TemplateSchema, paramId: string): TemplateSchema {
  return withParams(
    schema,
    flat(schema).filter((p) => p.paramId !== paramId),
  );
}

export function addParam(
  schema: TemplateSchema,
  categoryId: string,
  name = 'New parameter',
): TemplateSchema {
  const taken = new Set(schema.parameters.map((p) => p.paramId));
  const paramId = slugId('p', `${name} ${taken.size + 1}`, taken);
  return withParams(schema, [...flat(schema), { paramId, categoryId, name, order: 999 }]);
}

export function renameCategory(
  schema: TemplateSchema,
  categoryId: string,
  name: string,
): TemplateSchema {
  return {
    ...schema,
    categories: schema.categories.map((c) => (c.categoryId === categoryId ? { ...c, name } : c)),
  };
}

export function moveCategory(
  schema: TemplateSchema,
  categoryId: string,
  delta: -1 | 1,
): TemplateSchema {
  const list = orderedCategories(schema);
  const i = list.findIndex((c) => c.categoryId === categoryId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return schema;
  [list[i], list[j]] = [list[j], list[i]];
  return { ...schema, categories: list.map((c, k) => ({ ...c, order: k })) };
}

export function removeCategory(schema: TemplateSchema, categoryId: string): TemplateSchema {
  return {
    ...schema,
    categories: orderedCategories(schema)
      .filter((c) => c.categoryId !== categoryId)
      .map((c, k) => ({ ...c, order: k })),
    parameters: renumber(flat(schema).filter((p) => p.categoryId !== categoryId)),
  };
}

export function addCategory(schema: TemplateSchema, name: string): TemplateSchema {
  const clean = name.trim();
  if (!clean) return schema;
  const taken = new Set(schema.categories.map((c) => c.categoryId));
  const categoryId = slugId('c', clean, taken);
  return {
    ...schema,
    categories: [
      ...schema.categories,
      { categoryId, name: clean, order: schema.categories.length },
    ],
  };
}
