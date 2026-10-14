"use strict";
/**
 *
 * @param {String} string
 * @param {String} character
 */
function ltrim(string, character) {
  let cutted = 0,
    chars = Object.fromEntries(character.split("").map((e) => [e, true]));

  while (chars[string[cutted]] ?? false) {
    cutted++;
  }

  return string.slice(cutted);
}

/**
 *
 * @param {String} string
 * @param {String} character
 */
function rtrim(string, character) {
  let lastIndex = string.length - 1,
    chars = Object.fromEntries(character.split("").map((e) => [e, true]));

  while ((chars[string[lastIndex]] ?? false) && lastIndex >= 0) {
    lastIndex--;
  }

  return string.slice(0, lastIndex + 1);
}

/**
 *
 * @param {String} string
 * @param {String} character
 */
function trim(string, character) {
  return rtrim(ltrim(string, character), character);
}

/**
 * @param {any} v
 * @param {any} defaultV
 * @returns {any}
 */
function value(v, defaultV) {
  return typeof v == "undefined" ? defaultV : v;
}

/**
 * @param {any} v
 * @param {() => any} defaultV
 * @returns {any}
 */
function valueComputed(v, defaultV) {
  return typeof v == "undefined" ? defaultV() : v;
}

function currentUri(withHash = false) {
  let res = withHash
    ? `${window.location.pathname}${window.location.hash}`
    : window.location.pathname;
  // console.log("CALLED", res);
  return res;
}

export {
  ltrim,
  rtrim,
  trim,
  currentUri,
  value,
  valueComputed,
};
