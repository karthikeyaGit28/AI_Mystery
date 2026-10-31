type SchemaObject = Record<string, unknown>;

function object(value: unknown): value is SchemaObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Reduce the provider's decoding grammar without changing runtime validators.
 * Google rejects nested array bounds, numeric ranges and date-time formats when
 * their combined grammar has too many states. Those rules remain prompt guidance
 * here; the original Zod schema and canon checks still decide whether to publish.
 */
export function toGeminiResponseSchema(schema: SchemaObject): SchemaObject {
  const result = structuredClone(schema);

  function visit(node: unknown): void {
    if (!object(node)) return;
    const guidance: string[] = [];
    const minimumItems = node.minItems;
    const maximumItems = node.maxItems;
    const prefix = node.prefixItems;
    const sameTupleItems =
      Array.isArray(prefix) &&
      prefix.length > 0 &&
      prefix.every((item) => JSON.stringify(item) === JSON.stringify(prefix[0]));
    const exactHomogeneousTuple =
      sameTupleItems &&
      Array.isArray(prefix) &&
      node.items === false &&
      minimumItems === prefix.length &&
      maximumItems === prefix.length;

    if (exactHomogeneousTuple && Array.isArray(prefix)) {
      // Three identical hint positions are exactly the same language as three
      // homogeneous string items. Keep this small, exact count in the grammar.
      node.items = prefix[0];
      delete node.prefixItems;
    } else {
      delete node.minItems;
      delete node.maxItems;
    }
    if (typeof minimumItems === 'number' && minimumItems === maximumItems) {
      guidance.push(`Must contain exactly ${minimumItems} items.`);
    } else {
      if (typeof minimumItems === 'number')
        guidance.push(`Must contain at least ${minimumItems} items.`);
      if (typeof maximumItems === 'number')
        guidance.push(`Must contain at most ${maximumItems} items.`);
    }

    for (const [key, operator] of [
      ['minimum', '>='],
      ['maximum', '<='],
      ['exclusiveMinimum', '>'],
      ['exclusiveMaximum', '<'],
    ] as const) {
      if (typeof node[key] === 'number') guidance.push(`Value must be ${operator} ${node[key]}.`);
      delete node[key];
    }

    if (node.format === 'date-time') {
      delete node.format;
      // Zod emits both a date-time format and a large leap-year/timezone regex.
      // Removing just the format would leave the same costly lexical constraint.
      delete node.pattern;
      guidance.push(
        'Must be a valid ISO 8601 date-time including seconds and an explicit Z or numeric timezone offset.',
      );
    }
    if (guidance.length) {
      node.description = [typeof node.description === 'string' ? node.description : '', ...guidance]
        .filter(Boolean)
        .join(' ');
    }

    // Walk schema positions only: a real property named "minimum" or "format"
    // is application data, not a schema keyword to remove.
    for (const key of [
      'properties',
      '$defs',
      'definitions',
      'patternProperties',
      'dependentSchemas',
    ]) {
      const children = node[key];
      if (object(children)) for (const child of Object.values(children)) visit(child);
    }
    for (const key of [
      'items',
      'additionalProperties',
      'additionalItems',
      'propertyNames',
      'contains',
      'not',
      'if',
      'then',
      'else',
      'unevaluatedItems',
      'unevaluatedProperties',
    ]) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
    for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) {
      const children = node[key];
      if (Array.isArray(children)) children.forEach(visit);
    }
  }

  visit(result);
  return result;
}
