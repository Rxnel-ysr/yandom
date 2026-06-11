// native-watcher.js
"use strict";
import fs from 'fs';
import path from 'path';

const _watchedFile = new Set();

/**
 * Normalize ignore paths into absolute paths.
 */
function buildIgnoreList(baseDir, ignore = []) {
    return ignore.map(p => {
        const abs = path.resolve(baseDir, p);
        return abs.endsWith(path.sep) ? abs : abs + path.sep;
    });
}

/**
 * Check if a path should be ignored.
 */
function isIgnored(fullPath, ignoreList) {
    const p = fullPath.endsWith(path.sep) ? fullPath : fullPath + path.sep;
    return ignoreList.some(ig => p.startsWith(ig));
}

/**
 * Recursively watch all files in a directory.
 */
function watchDirRecursive(dir, onChange, opt = {}, ignoreList) {
    if (isIgnored(dir, ignoreList)) return;

    const extPattern = (opt.ext || ['js', 'ts'])
        .map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
    const ext = new RegExp('\\.(' + extPattern + ')$');
    const debounceDelay = opt.debounce || 100;

    fs.watch(dir, (event, filename) => {
        if (!filename) return;
        const fullPath = path.join(dir, filename);

        if (isIgnored(fullPath, ignoreList)) return;

        if (event === 'rename') {
            if (fs.existsSync(fullPath)) {
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    watchDirRecursive(fullPath, onChange, opt, ignoreList);
                } else if (opt.watchAll || ext.test(filename)) {
                    watchFile(fullPath, onChange, debounceDelay, opt.notice || false);
                    if (opt.notice) console.log(`[watch] New file: ${fullPath}`);
                    onChange(fullPath);
                }
            }
        }
    });

    fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
        const fullPath = path.join(dir, entry.name);

        if (isIgnored(fullPath, ignoreList)) return;

        if (entry.isDirectory()) {
            watchDirRecursive(fullPath, onChange, opt, ignoreList);
        } else if (opt.watchAll || ext.test(entry.name)) {
            watchFile(fullPath, onChange, debounceDelay, opt.notice || false);
        }
    });
}

/**
 * Watch a single file.
 */
function watchFile(file, onChange, debounceDelay = 100, notice = false) {
    if (_watchedFile.has(file)) return;
    _watchedFile.add(file);

    try {
        let delay;
        fs.watch(file, (event) => {
            if (event === 'change') {
                clearTimeout(delay);
                delay = setTimeout(() => {
                    if (notice) console.log(`[watch] ${file} modified`);
                    onChange(file);
                }, debounceDelay);
            }
        });
    } catch (err) {
        console.error(`[error] Can't watch ${file}`, err);
    }
}

export function watch(entry, onChange, opt = {}) {
    const abs = path.resolve(entry);
    const stat = fs.statSync(abs);

    const ignoreList = buildIgnoreList(abs, opt.ignore || []);

    if (stat.isDirectory()) {
        watchDirRecursive(abs, onChange, opt, ignoreList);
    } else {
        if (!isIgnored(abs, ignoreList)) {
            watchFile(abs, onChange, opt.debounce || 100, opt.notice || false);
        }
    }
}
