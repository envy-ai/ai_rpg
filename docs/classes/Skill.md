# Skill

## Purpose
Represents a character skill with a name, description, and optional attribute association.

## Construction
- `new Skill({ name, description, attribute })`: requires a non-empty string name. Description/attribute are optional strings.

## Instance API
- `update({ name, description, attribute })`: updates fields in place, trimming strings; ignores invalid or empty names.
- `toJSON()`: returns a plain object `{ name, description, attribute }`.

## Static API
- `fromJSON(data)`: validates and constructs a Skill from a plain object.

## Notes
- Input validation is strict: missing or non-string names throw errors.
