function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertString(value, fieldName) {
  assert(typeof value === 'string' && value.trim().length > 0, `${fieldName} must be a non-empty string`);
}

function assertOneOf(value, fieldName, allowedValues) {
  assert(allowedValues.includes(value), `${fieldName} must be one of: ${allowedValues.join(', ')}`);
}

function assertObject(value, fieldName) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${fieldName} must be an object`);
}

function assertArray(value, fieldName) {
  assert(Array.isArray(value), `${fieldName} must be an array`);
}

function assertNonEmptyArray(value, fieldName) {
  assertArray(value, fieldName);
  assert(value.length > 0, `${fieldName} must contain at least one item`);
}

function assertOptionalArray(value, fieldName) {
  if (value === undefined || value === null) {
    return;
  }

  assert(Array.isArray(value), `${fieldName} must be an array when provided`);
}

function assertBoolean(value, fieldName) {
  assert(typeof value === 'boolean', `${fieldName} must be a boolean`);
}

module.exports = {
  assert,
  assertArray,
  assertBoolean,
  assertNonEmptyArray,
  assertObject,
  assertOneOf,
  assertOptionalArray,
  assertString
};
