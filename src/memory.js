"use strict";

/**
 * Memory - A class-based memory system with validation and dependency tracking
 */
class Memory {
    /**
     * Create a new MemoryManager instance
     * @param {number} autoCleanupInterval
     */
    constructor(autoCleanupInterval = 300000) {
        this.Memory = new Map();
        this.ValidationQueue = new Set();
        this.Validators = new Map();
        this.isValidationRunning = false;
        this._cleanupInterval = null;

        this.startAutoCleanup(autoCleanupInterval);
    }

    /**
     * Start automatic cleanup of expired entries
     * @param {number} intervalMs - Cleanup interval in milliseconds
     */
    startAutoCleanup(intervalMs = 300000) {
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
        }
        this._cleanupInterval = setInterval(() => {
            this.cleanupExpired().catch(() => { });
        }, intervalMs);
    }

    /**
     * Stop automatic cleanup
     */
    stopAutoCleanup() {
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
            this._cleanupInterval = null;
        }
    }

    /**
     * Store a value in memory with optional TTL and invalidation callback
     * @template T
     * @param {any} definition - component identity key
     * @param {T} value - state snapshot
     * @param {number} ttl - milliseconds (0 = no expiry)
     * @param {null|((value?: T, reason?: string) => void)} [onInvalidate] - optional callback when value is invalidated
     */
    memorize(definition, value, ttl = 0, onInvalidate = null) {
        const expiresAt = ttl > 0 ? Date.now() + ttl : 0;

        this.Memory.set(definition, {
            value,
            expiresAt,
            createdAt: Date.now(),
            lastAccessed: null,
            accessCount: 0,
            onInvalidate
        });

        // Schedule validation for this new entry
        this._scheduleValidation(definition);
    }

    /**
     * Retrieve a value from memory
     * @param {any} definition
     * @returns {any|undefined}
     */
    recall(definition) {
        const entry = this.Memory.get(definition);
        if (!entry) {
            // Even if not found, validate others that might reference this
            this._scheduleValidation(definition, true);
            return;
        }

        // Synchronous expiration check
        if (entry.expiresAt && entry.expiresAt < Date.now()) {
            const value = entry.value;
            this.Memory.delete(definition);
            // Schedule cleanup validation
            this._scheduleValidation(definition, true);
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
        this._scheduleValidation(definition);

        return entry.value;
    }

    /**
     * Remove a value from memory
     * @param {any} definition
     * @returns {boolean} Whether the value existed
     */
    forget(definition) {
        const entry = this.Memory.get(definition);
        const existed = this.Memory.delete(definition);

        if (existed && entry && entry.onInvalidate) {
            // Fire onInvalidate callback asynchronously
            Promise.resolve().then(() => {
                entry.onInvalidate(entry.value, 'manual');
            }).catch(() => { });
        }

        // Schedule validation since this removal might affect others
        this._scheduleValidation(definition, true);

        return existed;
    }

    /**
     * Check if a value exists in memory (and is not expired)
     * @param {any} definition
     * @returns {boolean}
     */
    remembered(definition) {
        const entry = this.Memory.get(definition);
        if (!entry) {
            this._scheduleValidation(definition, true);
            return false;
        }

        if (entry.expiresAt && entry.expiresAt < Date.now()) {
            const value = entry.value;
            this.Memory.delete(definition);
            this._scheduleValidation(definition, true);
            if (entry.onInvalidate) {
                Promise.resolve().then(() => {
                    entry.onInvalidate(value, 'expired');
                }).catch(() => { });
            }
            return false;
        }

        // Schedule validation for this checked entry
        this._scheduleValidation(definition);

        return true;
    }

    /**
     * Register a validator function for a definition or pattern
     * @param {any} definition - definition key or pattern
     * @param {Function} validator - async function that checks validity
     * @param {Object} [options] - validator options
     */
    registerValidator(definition, validator, options = {}) {
        const enhancedValidator = async (...args) => {
            return await validator(...args);
        };

        // Attach additional handlers
        if (options.onDependencyRemoved) {
            enhancedValidator.onDependencyRemoved = options.onDependencyRemoved;
        }

        this.Validators.set(definition, enhancedValidator);
    }

    /**
     * Unregister a validator
     * @param {any} definition
     */
    unregisterValidator(definition) {
        this.Validators.delete(definition);
    }

    /**
     * Schedule async validation for definitions
     * @private
     * @param {any} definition - the definition that was accessed/changed
     * @param {boolean} [removed=false] - whether this definition was removed
     */
    _scheduleValidation(definition, removed = false) {
        // Always add the definition to validation queue if it still exists
        if (!removed && this.Memory.has(definition)) {
            this.ValidationQueue.add(definition);
        } else if (removed) {
            // When removed, we might still need to validate the definition itself
            // if there are validators registered for it (like pattern validators)
            this.ValidationQueue.add(definition);
        }

        // Also add any definitions that might depend on this one
        for (const [key, entry] of this.Memory.entries()) {
            // Check if this key might depend on the accessed definition
            if (key !== definition && this._mightDependOn(key, definition)) {
                this.ValidationQueue.add(key);

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
            for (const [validatorKey, validator] of this.Validators.entries()) {
                if (this._validatorApplies(validatorKey, definition)) {
                    // This validator applies to the removed definition
                    // We might want to clean up the validator or log it
                    console.debug(`Validator for removed definition: ${definition}`);
                }
            }
        }

        // Trigger async validation if not already running
        if (!this.isValidationRunning) {
            this.isValidationRunning = true;
            // Run validation on next tick to avoid blocking
            Promise.resolve().then(() => this._runQueuedValidations()).catch(() => {
                this.isValidationRunning = false;
            });
        }
    }

    /**
     * Check if one definition might depend on another
     * @private
     * @param {any} dependent - potential dependent definition
     * @param {any} dependency - potential dependency
     * @returns {boolean}
     */
    _mightDependOn(dependent, dependency) {
        // Check if dependent's value references dependency in some way
        const dependentEntry = this.Memory.get(dependent);
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
     * @private
     */
    async _runQueuedValidations() {
        const validationBatch = [];

        // Process validation queue
        for (const definition of this.ValidationQueue) {
            validationBatch.push(definition);
        }
        this.ValidationQueue.clear();

        // Process in batches to avoid overwhelming the system
        for (const definition of validationBatch) {
            const entry = this.Memory.get(definition);
            const wasRemoved = !entry; // Entry doesn't exist in memory

            // Special handling for removed definitions
            if (wasRemoved) {
                await this._handleRemovedDefinition(definition);
                continue;
            }

            // Run validators for existing entries
            await this._validateDefinition(definition, entry);
        }

        this.isValidationRunning = false;
    }

    /**
     * Handle validation for a definition that was removed
     * @private
     * @param {any} definition
     */
    async _handleRemovedDefinition(definition) {
        // Check if any validators still apply to this removed definition
        for (const [validatorKey, validator] of this.Validators.entries()) {
            if (this._validatorApplies(validatorKey, definition)) {
                try {
                    // Some validators might want to know when a definition is removed
                    // e.g., to clean up external resources
                    if (validator.onDependencyRemoved) {
                        await validator.onDependencyRemoved(definition, this.Memory);
                    }
                } catch (error) {
                    console.warn(`onDependencyRemoved handler failed for ${definition}:`, error);
                }
            }
        }
    }

    /**
     * Validate a specific definition
     * @private
     * @param {any} definition
     * @param {Object} entry
     */
    async _validateDefinition(definition, entry) {
        // Skip if entry was already removed during this validation cycle
        if (!this.Memory.has(definition)) return;

        // Run applicable validators
        for (const [validatorKey, validator] of this.Validators.entries()) {
            try {
                if (this._validatorApplies(validatorKey, definition)) {
                    const isValid = await validator(
                        entry.value,
                        definition,
                        this.Memory,
                        entry
                    );

                    if (!isValid) {
                        // Invalidated by validator
                        const value = entry.value;
                        const onInvalidate = entry.onInvalidate;
                        this.Memory.delete(definition);

                        if (onInvalidate) {
                            try {
                                await Promise.resolve().then(() =>
                                    onInvalidate(value, 'validator')
                                );
                            } catch { }
                        }

                        // This definition is now removed, schedule dependent validations
                        this._scheduleValidation(definition, true);
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
                                this.Memory
                            );

                            if (!dependencyValid) {
                                // Entry is invalid due to dependency removal
                                const value = entry.value;
                                const onInvalidate = entry.onInvalidate;
                                this.Memory.delete(definition);

                                if (onInvalidate) {
                                    try {
                                        await Promise.resolve().then(() =>
                                            onInvalidate(value, 'dependency_removed')
                                        );
                                    } catch { }
                                }

                                this._scheduleValidation(definition, true);
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
     * @private
     * @param {any} validatorKey
     * @param {any} definition
     * @returns {boolean}
     */
    _validatorApplies(validatorKey, definition) {
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
    async findOrphans() {
        const orphans = [];

        for (const [definition, entry] of this.Memory.entries()) {
            let referenced = false;

            // Check if any other entry references this definition
            for (const [otherDef, otherEntry] of this.Memory.entries()) {
                if (otherDef === definition) continue;

                if (this._mightDependOn(otherDef, definition)) {
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
    async cleanupExpired() {
        const now = Date.now();
        const expired = [];

        // Collect expired entries
        for (const [definition, entry] of this.Memory.entries()) {
            if (entry.expiresAt && entry.expiresAt < now) {
                expired.push({ definition, entry });
            }
        }

        // Remove them
        for (const { definition, entry } of expired) {
            this.Memory.delete(definition);
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
            this._scheduleValidation(definition, true);
        }

        return expired.length;
    }

    /**
     * Manually trigger validation for all entries
     * @returns {Promise<number>} number of invalidated entries
     */
    async validateAll() {
        // Add all current definitions to validation queue
        for (const definition of this.Memory.keys()) {
            this.ValidationQueue.add(definition);
        }

        // Trigger validation
        if (!this.isValidationRunning) {
            this.isValidationRunning = true;
            await this._runQueuedValidations();
        }

        return 0; // Invalidations happen within _runQueuedValidations
    }

    /**
     * Clear all memory entries
     * @returns {number} Number of entries cleared
     */
    clear() {
        const count = this.Memory.size;
        this.Memory.clear();
        this.ValidationQueue.clear();
        return count;
    }

    /**
     * Get memory statistics
     * @returns {Object} Memory statistics
     */
    getStats() {
        let totalSize = 0;
        let expiredCount = 0;
        const now = Date.now();

        for (const entry of this.Memory.values()) {
            try {
                const json = JSON.stringify(entry.value);
                totalSize += new Blob([json]).size;
            } catch {
                // If can't serialize, estimate
                totalSize += 100;
            }

            if (entry.expiresAt && entry.expiresAt < now) {
                expiredCount++;
            }
        }

        return {
            totalEntries: this.Memory.size,
            expiredEntries: expiredCount,
            estimatedSizeBytes: totalSize,
            validatorsCount: this.Validators.size,
            pendingValidations: this.ValidationQueue.size
        };
    }

    /**
     * Export internal state for testing or persistence
     * @returns {Object} Internal state
     */
    getInternalState() {
        return {
            Memory: this.Memory,
            Validators: this.Validators,
            ValidationQueue: this.ValidationQueue
        };
    }

    /**
     * Destroy the memory manager and clean up resources
     */
    destroy() {
        this.stopAutoCleanup();
        this.clear();
        this.Validators.clear();
    }
}

export default Memory;