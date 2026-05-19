"use strict";
import env from /** Skip */ '../../env.json' with {type: 'json'}

class FileReader {
    constructor(basePath = '') {
        this.basePath = basePath;
    }

    async getFileAsString(filename) {
        const url = `${this.basePath}/${filename}`.replace(/\/+/g, '/');
        const response = await fetch(url);
        return await response.text();
    }
}

const fileReader = new FileReader(window.location.pathname);

const getFileAsString = async (filename) => {
    return await fileReader.getFileAsString(filename)
}

/**
 * 
 * @param {String} uri
 * @return url
 */
const file = (uri) => {
    let res = '';
    if (env.deploy) {
        res = `${window.location.origin}/Baria/${uri}`
    } else {
        res = `${window.location.origin}/${uri}`

    }
    return res;
}

/**
 * 
 * @param {String} string 
 * @param {String} character 
 */
const ltrim = (string, character) => {
    let cutted = 0;

    while (string[cutted] == character) {
        cutted++
    }

    return string.slice(cutted)
}

/**
 * 
 * @param {String} string 
 * @param {String} character 
 */
const rtrim = (string, character) => {
    let lastIndex = string.length - 1;

    while (string[lastIndex] == character && lastIndex >= 0) {
        lastIndex--
    }

    return string.slice(0, lastIndex + 1)
}

/**
 * 
 * @param {String} string 
 * @param {String} character 
 */
const trim = (string, character) => rtrim(ltrim(string, character), character);

/**
 * @param {any} v 
 * @param {any} defaultV 
 * @returns {any}
 */
const value = (v, defaultV) => {
    return typeof v == 'undefined' ? defaultV : v
}

const currentUri = (withHash = false) => {
    let res = withHash ? `${window.location.pathname}${window.location.hash}` : window.location.pathname
    // console.log("CALLED", res);
    return res;
};

/**
 * Generate RFC 4122–compliant UUID v4.
 * Uses Web Crypto. Secure. Collision-safe.
 *
 * @returns {string} UUID v4
 */
const uuidv4 = () =>  {
    const b = crypto.getRandomValues(new Uint8Array(16));

    // RFC 4122 compliance
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10

    return (
        [...b].map((v, i) =>
            ([4, 6, 8, 10].includes(i) ? "-" : "") +
            v.toString(16).padStart(2, "0")
        ).join("")
    );
}

export { file, ltrim, rtrim, trim, currentUri, uuidv4, FileReader, getFileAsString, value }