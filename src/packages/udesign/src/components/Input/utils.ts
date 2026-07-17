import type { InputValue } from './type';

/** 判断字符是否为全角（中文等），计 2 个字符长度 */
function isWideCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  return code > 255;
}

/** 获取字符长度（中文计 2） */
export function getCharacterLength(value: InputValue): number {
  return Array.from(value).reduce(
    (len, char) => len + (isWideCharacter(char) ? 2 : 1),
    0,
  );
}

/** 获取文本长度（中文计 1） */
export function getStringLength(value: InputValue): number {
  return value.length;
}

/** 按 maxcharacter 截断字符串 */
export function limitByMaxCharacter(
  value: InputValue,
  maxcharacter: number,
): InputValue {
  let len = 0;
  let result = '';
  for (const char of value) {
    const charLen = isWideCharacter(char) ? 2 : 1;
    if (len + charLen > maxcharacter) break;
    len += charLen;
    result += char;
  }
  return result;
}

/** 按 maxlength 截断字符串 */
export function limitByMaxLength(
  value: InputValue,
  maxlength: number,
): InputValue {
  return value.slice(0, maxlength);
}

/** 根据限制类型截断值 */
export function limitValue(
  value: InputValue,
  options: { maxcharacter?: number; maxlength?: number },
): InputValue {
  const { maxcharacter, maxlength } = options;
  if (maxcharacter != null) {
    return limitByMaxCharacter(value, maxcharacter);
  }
  if (maxlength != null) {
    return limitByMaxLength(value, maxlength);
  }
  return value;
}

/** 获取当前值的长度（根据限制类型） */
export function getValueLength(
  value: InputValue,
  options: { maxcharacter?: number; maxlength?: number },
): number {
  if (options.maxcharacter != null) {
    return getCharacterLength(value);
  }
  if (options.maxlength != null) {
    return getStringLength(value);
  }
  return getStringLength(value);
}

/** 获取最大限制值 */
export function getMaxLimit(options: {
  maxcharacter?: number;
  maxlength?: number;
}): number | undefined {
  if (options.maxcharacter != null) return options.maxcharacter;
  if (options.maxlength != null) return options.maxlength;
  return undefined;
}

/** 判断值是否超出限制 */
export function isExceedLimit(
  value: InputValue,
  options: {
    maxcharacter?: number;
    maxlength?: number;
  },
): boolean {
  const max = getMaxLimit(options);
  if (max == null) return false;
  return getValueLength(value, options) > max;
}
