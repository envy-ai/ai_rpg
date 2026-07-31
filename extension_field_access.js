'use strict';

/**
 * Shared mod extension-field machinery for entity classes (Thing, Player).
 * The factory is parameterized by the mod-extension registry key ('thing' /
 * 'player') and the class label used in error messages; everything else is
 * identical between the two classes. Error message text is preserved exactly.
 *
 * Globals is required lazily to avoid participating in the existing
 * circular-require graph at module load time.
 */

function getRegistry() {
    const Globals = require('./Globals.js');
    return Globals.modExtensionRegistry;
}

function createExtensionFieldAccess({ entityType, label }) {
    function getRegisteredFields() {
        const registry = getRegistry();
        if (!registry || typeof registry.getEntityFields !== 'function') {
            return [];
        }
        return registry.getEntityFields(entityType);
    }

    function getRegisteredField(fieldName) {
        const normalized = typeof fieldName === 'string' ? fieldName.trim() : '';
        if (!normalized) {
            return null;
        }
        const registry = getRegistry();
        if (!registry || typeof registry.getEntityField !== 'function') {
            return null;
        }
        return registry.getEntityField(entityType, normalized);
    }

    function getRequiredField(fieldName) {
        const field = getRegisteredField(fieldName);
        if (!field) {
            throw new Error(`${label} extension field "${fieldName}" is not registered.`);
        }
        return field;
    }

    function cloneValue(value) {
        if (value === undefined) {
            return undefined;
        }
        if (value === null || typeof value !== 'object') {
            return value;
        }
        return JSON.parse(JSON.stringify(value));
    }

    function normalizeValue(field, value) {
        if (value === undefined || value === null) {
            return value;
        }
        switch (field.type) {
            case 'string':
                return String(value).trim();
            case 'number': {
                const numeric = Number(value);
                if (!Number.isFinite(numeric)) {
                    throw new Error(`${label} extension field "${field.fieldName}" must be a finite number.`);
                }
                return numeric;
            }
            case 'integer': {
                const numeric = Number(value);
                if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
                    throw new Error(`${label} extension field "${field.fieldName}" must be an integer.`);
                }
                return numeric;
            }
            case 'boolean':
                if (typeof value !== 'boolean') {
                    throw new Error(`${label} extension field "${field.fieldName}" must be a boolean.`);
                }
                return value;
            case 'array':
                if (!Array.isArray(value)) {
                    throw new Error(`${label} extension field "${field.fieldName}" must be an array.`);
                }
                return cloneValue(value);
            case 'object':
                if (!value || typeof value !== 'object' || Array.isArray(value)) {
                    throw new Error(`${label} extension field "${field.fieldName}" must be an object.`);
                }
                return cloneValue(value);
            default:
                throw new Error(`${label} extension field "${field.fieldName}" has unsupported type "${field.type}".`);
        }
    }

    function shouldStoreValue(value) {
        if (value === undefined || value === null) {
            return false;
        }
        return !(typeof value === 'string' && value.length === 0);
    }

    function extractInputs(data) {
        const inputs = {};
        if (!data || typeof data !== 'object') {
            return inputs;
        }
        for (const field of getRegisteredFields()) {
            if (Object.prototype.hasOwnProperty.call(data, field.fieldName)) {
                inputs[field.fieldName] = data[field.fieldName];
            }
        }
        return inputs;
    }

    function getField(extensionFields, fieldName) {
        const field = getRequiredField(fieldName);
        if (Object.prototype.hasOwnProperty.call(extensionFields, field.fieldName)) {
            return cloneValue(extensionFields[field.fieldName]);
        }
        return cloneValue(field.defaultValue);
    }

    function getFields(extensionFields, { includeDefaults = false } = {}) {
        const output = {};
        for (const field of getRegisteredFields()) {
            if (Object.prototype.hasOwnProperty.call(extensionFields, field.fieldName)) {
                output[field.fieldName] = cloneValue(extensionFields[field.fieldName]);
            } else if (includeDefaults && field.defaultValue !== undefined) {
                output[field.fieldName] = cloneValue(field.defaultValue);
            }
        }
        return output;
    }

    /**
     * Validate and store (or clear) a single field value on the given
     * extension-fields store. Timestamp updates stay in the owning class.
     */
    function setFieldValue(entity, extensionFields, field, value) {
        const normalized = normalizeValue(field, value);
        if (typeof field.validateValue === 'function') {
            field.validateValue(cloneValue(normalized), {
                entity,
                entityType,
                fieldName: field.fieldName
            });
        }
        if (shouldStoreValue(normalized)) {
            extensionFields[field.fieldName] = normalized;
        } else {
            delete extensionFields[field.fieldName];
        }
    }

    function applyInputs(entity, extensionFields, inputs = {}) {
        if (!inputs || typeof inputs !== 'object') {
            return;
        }
        for (const field of getRegisteredFields()) {
            if (Object.prototype.hasOwnProperty.call(inputs, field.fieldName)) {
                setFieldValue(entity, extensionFields, field, inputs[field.fieldName]);
            }
        }
    }

    function installAccessors(instance) {
        for (const field of getRegisteredFields()) {
            if (field.fieldName in instance) {
                throw new Error(`${label} extension field "${field.fieldName}" conflicts with an existing ${label} property.`);
            }
            Object.defineProperty(instance, field.fieldName, {
                configurable: true,
                enumerable: false,
                get: () => instance.getExtensionField(field.fieldName),
                set: value => instance.setExtensionField(field.fieldName, value)
            });
        }
    }

    return {
        getRegisteredFields,
        getRegisteredField,
        getRequiredField,
        cloneValue,
        normalizeValue,
        shouldStoreValue,
        extractInputs,
        getField,
        getFields,
        setFieldValue,
        applyInputs,
        installAccessors
    };
}

module.exports = { createExtensionFieldAccess };
