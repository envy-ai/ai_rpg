# Quest

## Purpose
Tracks a quest with objectives, rewards, giver info, and completion state. Maintains static indexes for lookup by id and name.

## Key State
- `#id`: quest id (generated if not provided).
- `objectives`: array of QuestObjective instances.
- `name`, `description`, `secretNotes`.
- `rewardItems`, `rewardCurrency`, `rewardXp`, `rewardClaimed`.
- `giverId`, `giverName`.
- `paused`: whether the quest is paused.

## Construction
- `new Quest(options)` validates name and normalizes objectives and reward fields. Adds to static indexes by id and name.

## Instance API
- `get id()`: returns quest id.
- `get giver()`: resolves giver via `Player.getById`.
- `set giver(player)`: updates `giverId`/`giverName`.
- `get completed()`: true when all objectives are completed or optional.
- `addObjective(description, optional)`: appends a new QuestObjective.
- `completeObjective(index)`: marks objective completed or throws on invalid index.
- `toJSON()`: serializes quest state.

## Static API
- `getByName(name)`, `getById(id)`: lookup from indexes.
- `fromJSON(data)`: validates, normalizes, and constructs a Quest, then hydrates objectives.
- `filterActiveQuests(quests, { includePaused })`: filters out completed quests and optionally paused ones.

## Internal Class: QuestObjective
- `new QuestObjective(description, optional)`: creates an objective with generated id.
- `static generateId()`: generates objective ids.
- `toJSON()` / `fromJSON(data)`: serialization helpers.
- `get id()`: returns objective id.

## Notes
- `Quest.QuestObjective` is assigned for external access to the helper class.
- The class uses `SanitizedStringMap` for case-insensitive name lookups.
