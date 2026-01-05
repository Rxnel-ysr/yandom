"use strict";

const Memory = new Map();
const ValidationQueue = new Set();
let isValidationRunning = false;

/**
 * Validation registry for cross-value dependencies
 * @type {Map<any, Function>}
 */
const Validators = new Map();

/**
 * @param {any} definition - component identity key
 * @param {any} value - state snapshot
 * @param {number} ttl - milliseconds (0 = no expiry)
 * @param {Function} [onInvalidate] - optional callback when value is invalidated
 */
export function memorize(definition, value, ttl = 0, onInvalidate = null) {
    const expiresAt = ttl > 0 ? Date.now() + ttl : 0;

    Memory.set(definition, {
        value,
        expiresAt,
        createdAt: Date.now(),
        lastAccessed: null,
        accessCount: 0,
        onInvalidate
    });

    // Schedule validation for this new entry
    scheduleValidation(definition);
}

/**
 * @param {any} definition
 * @returns {any|undefined}
 */
export function recall(definition) {
    const entry = Memory.get(definition);
    if (!entry) {
        // Even if not found, validate others that might reference this
        scheduleValidation(definition, true);
        return;
    }

    // Synchronous expiration check
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
        const value = entry.value;
        Memory.delete(definition);
        // Schedule cleanup validation
        scheduleValidation(definition, true);
        if (entry.onInvalidate) {
            // Fire onInvalidate callback asynchronously
            Promise.resolve().then(() => {
                entry.onInvalidate(value, 'expired');
            }).catch(() => { });
        }
        return;
    }

    // Update access metadata
    entry.accessCount = (entry.accessCount || 0) + 1;
    entry.lastAccessed = Date.now();

    // Schedule validation for this accessed entry
    scheduleValidation(definition);

    return entry.value;
}

export function forget(definition) {
    const entry = Memory.get(definition);
    const existed = Memory.delete(definition);

    if (existed && entry && entry.onInvalidate) {
        // Fire onInvalidate callback asynchronously
        Promise.resolve().then(() => {
            entry.onInvalidate(entry.value, 'manual');
        }).catch(() => { });
    }

    // Schedule validation since this removal might affect others
    scheduleValidation(definition, true);

    return existed;
}

export function remembered(definition) {
    const entry = Memory.get(definition);
    if (!entry) {
        scheduleValidation(definition, true);
        return false;
    }

    if (entry.expiresAt && entry.expiresAt < Date.now()) {
        const value = entry.value;
        Memory.delete(definition);
        scheduleValidation(definition, true);
        if (entry.onInvalidate) {
            Promise.resolve().then(() => {
                entry.onInvalidate(value, 'expired');
            }).catch(() => { });
        }
        return false;
    }

    // Schedule validation for this checked entry
    scheduleValidation(definition);

    return true;
}

/**
 * Register a validator function for a definition or pattern
 * @param {any} definition - definition key or pattern
 * @param {Function} validator - async function that checks validity
 * @param {Object} [options] - validator options
 */
export function registerValidator(definition, validator, options = {}) {
    const enhancedValidator = async (...args) => {
        return await validator(...args);
    };

    // Attach additional handlers
    if (options.onDependencyRemoved) {
        enhancedValidator.onDependencyRemoved = options.onDependencyRemoved;
    }

    Validators.set(definition, enhancedValidator);
}

/**
 * Unregister a validator
 * @param {any} definition
 */
export function unregisterValidator(definition) {
    Validators.delete(definition);
}

/**
 * Schedule async validation for definitions
 * @param {any} definition - the definition that was accessed/changed
 * @param {boolean} [removed=false] - whether this definition was removed
 */
function scheduleValidation(definition, removed = false) {
    // Always add the definition to validation queue if it still exists
    if (!removed && Memory.has(definition)) {
        ValidationQueue.add(definition);
    } else if (removed) {
        // When removed, we might still need to validate the definition itself
        // if there are validators registered for it (like pattern validators)
        ValidationQueue.add(definition);
    }

    // Also add any definitions that might depend on this one
    for (const [key, entry] of Memory.entries()) {
        // Check if this key might depend on the accessed definition
        if (key !== definition && mightDependOn(key, definition)) {
            ValidationQueue.add(key);

            // If the dependency was removed, we might need to mark dependent entries
            if (removed && entry.markOnDependencyRemoval) {
                // Mark entry for special handling when dependency is removed
                entry.dependencyRemoved = true;
                entry.removedDependency = definition;
            }
        }
    }

    // If this was a removal, also check if there are any orphaned validators
    if (removed) {
        // Check if any validators were specifically for this definition
        for (const [validatorKey, validator] of Validators.entries()) {
            if (validatorApplies(validatorKey, definition)) {
                // This validator applies to the removed definition
                // We might want to clean up the validator or log it
                console.debug(`Validator for removed definition: ${definition}`);
            }
        }
    }

    // Trigger async validation if not already running
    if (!isValidationRunning) {
        isValidationRunning = true;
        // Run validation on next tick to avoid blocking
        Promise.resolve().then(runQueuedValidations).catch(() => {
            isValidationRunning = false;
        });
    }
}

/**
 * Check if one definition might depend on another
 * @param {any} dependent - potential dependent definition
 * @param {any} dependency - potential dependency
 * @returns {boolean}
 */
function mightDependOn(dependent, dependency) {
    // Check if dependent's value references dependency in some way
    const dependentEntry = Memory.get(dependent);
    if (!dependentEntry) return false;

    // Simple heuristic: check if dependency key appears in dependent's value
    try {
        const strVal = JSON.stringify(dependentEntry.value);
        const strKey = JSON.stringify(dependency);
        return strVal.includes(strKey.replace(/^"|"$/g, ''));
    } catch {
        return false;
    }
}

/**
 * Run all queued validations asynchronously
 */
async function runQueuedValidations() {
    const validationBatch = [];

    // Process validation queue
    for (const definition of ValidationQueue) {
        validationBatch.push(definition);
    }
    ValidationQueue.clear();

    // Process in batches to avoid overwhelming the system
    for (const definition of validationBatch) {
        const entry = Memory.get(definition);
        const wasRemoved = !entry; // Entry doesn't exist in memory

        // Special handling for removed definitions
        if (wasRemoved) {
            await handleRemovedDefinition(definition);
            continue;
        }

        // Run validators for existing entries
        await validateDefinition(definition, entry);
    }

    isValidationRunning = false;
}

/**
 * Handle validation for a definition that was removed
 * @param {any} definition
 */
async function handleRemovedDefinition(definition) {
    // Check if any validators still apply to this removed definition
    for (const [validatorKey, validator] of Validators.entries()) {
        if (validatorApplies(validatorKey, definition)) {
            try {
                // Some validators might want to know when a definition is removed
                // e.g., to clean up external resources
                if (validator.onDependencyRemoved) {
                    await validator.onDependencyRemoved(definition, Memory);
                }
            } catch (error) {
                console.warn(`onDependencyRemoved handler failed for ${definition}:`, error);
            }
        }
    }
}

/**
 * Validate a specific definition
 * @param {any} definition
 * @param {Object} entry
 */
async function validateDefinition(definition, entry) {
    // Skip if entry was already removed during this validation cycle
    if (!Memory.has(definition)) return;

    // Run applicable validators
    for (const [validatorKey, validator] of Validators.entries()) {
        try {
            if (validatorApplies(validatorKey, definition)) {
                const isValid = await validator(
                    entry.value,
                    definition,
                    Memory,
                    entry
                );

                if (!isValid) {
                    // Invalidated by validator
                    const value = entry.value;
                    const onInvalidate = entry.onInvalidate;
                    Memory.delete(definition);

                    if (onInvalidate) {
                        try {
                            await Promise.resolve().then(() =>
                                onInvalidate(value, 'validator')
                            );
                        } catch { }
                    }

                    // This definition is now removed, schedule dependent validations
                    scheduleValidation(definition, true);
                    break; // No need to check other validators
                }

                // Check if this entry had a dependency removed
                if (entry.dependencyRemoved) {
                    // Special handling for entries that lost a dependency
                    if (validator.onDependencyRemoved) {
                        const dependencyValid = await validator.onDependencyRemoved(
                            entry.removedDependency,
                            definition,
                            entry.value,
                            Memory
                        );

                        if (!dependencyValid) {
                            // Entry is invalid due to dependency removal
                            const value = entry.value;
                            const onInvalidate = entry.onInvalidate;
                            Memory.delete(definition);

                            if (onInvalidate) {
                                try {
                                    await Promise.resolve().then(() =>
                                        onInvalidate(value, 'dependency_removed')
                                    );
                                } catch { }
                            }

                            scheduleValidation(definition, true);
                            break;
                        }
                    }

                    // Clear the flag after handling
                    delete entry.dependencyRemoved;
                    delete entry.removedDependency;
                }
            }
        } catch (error) {
            console.warn(`Validator error for ${definition}:`, error);
        }
    }
}

/**
 * Check if a validator applies to a definition
 * @param {any} validatorKey
 * @param {any} definition
 * @returns {boolean}
 */
function validatorApplies(validatorKey, definition) {
    if (validatorKey === definition) return true;

    // Support pattern matching
    if (validatorKey instanceof RegExp && validatorKey.test(definition)) {
        return true;
    }

    // Support function-based matching
    if (typeof validatorKey === 'function') {
        try {
            return validatorKey(definition);
        } catch {
            return false;
        }
    }

    // Support wildcard patterns
    if (typeof validatorKey === 'string' && typeof definition === 'string') {
        if (validatorKey.endsWith('*')) {
            const prefix = validatorKey.slice(0, -1);
            return definition.startsWith(prefix);
        }
        if (validatorKey.startsWith('*')) {
            const suffix = validatorKey.slice(1);
            return definition.endsWith(suffix);
        }
    }

    return false;
}

/**
 * Get all orphaned entries (those not referenced by any other entry)
 * @returns {Promise<Array<{definition: any, value: any, orphaned: boolean}>>}
 */
export async function findOrphans() {
    const orphans = [];
    const allDefinitions = Array.from(Memory.keys());

    for (const [definition, entry] of Memory.entries()) {
        let referenced = false;

        // Check if any other entry references this definition
        for (const [otherDef, otherEntry] of Memory.entries()) {
            if (otherDef === definition) continue;

            if (mightDependOn(otherDef, definition)) {
                referenced = true;
                break;
            }
        }

        if (!referenced) {
            orphans.push({
                definition,
                value: entry.value,
                orphaned: true,
                age: Date.now() - entry.createdAt
            });
        }
    }

    return orphans;
}

/**
 * Clean up expired entries asynchronously
 * @returns {Promise<number>} number of cleaned entries
 */
export async function cleanupExpired() {
    const now = Date.now();
    const expired = [];

    // Collect expired entries
    for (const [definition, entry] of Memory.entries()) {
        if (entry.expiresAt && entry.expiresAt < now) {
            expired.push({ definition, entry });
        }
    }

    // Remove them
    for (const { definition, entry } of expired) {
        Memory.delete(definition);
        if (entry.onInvalidate) {
            try {
                await Promise.resolve().then(() =>
                    entry.onInvalidate(entry.value, 'cleanup')
                );
            } catch { }
        }
    }

    // Schedule validation for affected entries
    for (const { definition } of expired) {
        scheduleValidation(definition, true);
    }

    return expired.length;
}

/**
 * Manually trigger validation for all entries
 * @returns {Promise<number>} number of invalidated entries
 */
export async function validateAll() {
    // Add all current definitions to validation queue
    for (const definition of Memory.keys()) {
        ValidationQueue.add(definition);
    }

    // Trigger validation
    if (!isValidationRunning) {
        isValidationRunning = true;
        await runQueuedValidations();
    }

    return 0; // Invalidations happen within runQueuedValidations
}

// Auto cleanup every 5 minutes
setInterval(() => {
    cleanupExpired().catch(() => { });
}, 300000);

// Export for testing
export const _internal = {
    Memory,
    Validators,
    ValidationQueue,
    mightDependOn
};