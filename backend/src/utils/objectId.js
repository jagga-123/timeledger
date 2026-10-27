export const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

export const isValidObjectId = (value) => typeof value === 'string' && OBJECT_ID_REGEX.test(value);
