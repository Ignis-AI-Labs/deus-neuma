const MAX_SAFE_BYTES = BigInt(Number.MAX_SAFE_INTEGER);

/** Normalize an integer byte count without ever accepting lossy Number input. Pure. */
export const nonnegativeByteBigInt = (value, label = 'byte count') => {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new Error(`${label} must be nonnegative`);
    return value;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a finite safe nonnegative integer`);
  }
  return BigInt(value);
};

/** Add under an explicit ceiling, checking before addition. Pure. */
export const checkedByteSum = (accumulated, next, maximum, label = 'byte total') => {
  const total = nonnegativeByteBigInt(accumulated, `${label} accumulated`);
  const increment = nonnegativeByteBigInt(next, `${label} increment`);
  const limit = nonnegativeByteBigInt(maximum, `${label} maximum`);
  if (total > limit || increment > limit - total) {
    throw new Error(`${label} exceeds its byte ceiling`);
  }
  return total + increment;
};

/** Multiply under an explicit ceiling using unbounded arithmetic, then check. Pure. */
export const checkedByteProduct = (value, multiplier, maximum, label = 'byte product') => {
  const left = nonnegativeByteBigInt(value, `${label} value`);
  const right = nonnegativeByteBigInt(multiplier, `${label} multiplier`);
  const limit = nonnegativeByteBigInt(maximum, `${label} maximum`);
  if (left !== 0n && right > limit / left) {
    throw new Error(`${label} exceeds its byte ceiling`);
  }
  return left * right;
};

/** Convert only after a bigint has been bounded to an exact safe Number. Pure. */
export const safeByteNumber = (value, label = 'byte count', maximum = MAX_SAFE_BYTES) => {
  const bytes = nonnegativeByteBigInt(value, label);
  const limit = nonnegativeByteBigInt(maximum, `${label} maximum`);
  if (bytes > limit || bytes > MAX_SAFE_BYTES) {
    throw new Error(`${label} exceeds the safe integer range`);
  }
  return Number(bytes);
};

export { MAX_SAFE_BYTES };
