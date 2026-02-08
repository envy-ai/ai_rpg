class Globals {
  static config;

  static baseDir;
  static gameLoaded = false;
  static _processedMove = false;
  static inCombat = false;
  static #currentPlayerOverride = null;
  static realtimeHub = null;
  static travelHistory = [];
  static slopWords = [];
  static slopTrigrams = [];
  static currentSaveVersion = '1';
  static saveFileSaveVersion = '0';
  static sceneSummaries = null;
  static saveMetadata = null;
  static currentSaveInfo = null;
  static worldTime = null;
  static calendarDefinition = null;

  static #hashString(value) {
    const source = typeof value === 'string' ? value : String(value ?? '');
    let hash = 0;
    for (let i = 0; i < source.length; i += 1) {
      hash = ((hash << 5) - hash) + source.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  static #deepClone(value) {
    if (value === undefined) {
      return undefined;
    }
    return JSON.parse(JSON.stringify(value));
  }

  static getTimeConfig() {
    const source = Globals.config?.time;
    if (source !== undefined && source !== null && typeof source !== 'object') {
      throw new Error('time config must be an object when provided.');
    }

    const cycleLengthMinutesRaw = source?.cycleLengthMinutes ?? 1440;
    const cycleLengthMinutes = Number(cycleLengthMinutesRaw);
    if (!Number.isFinite(cycleLengthMinutes) || cycleLengthMinutes <= 0) {
      throw new Error('time.cycleLengthMinutes must be a positive number.');
    }

    const tickMinutesRaw = source?.tickMinutes ?? 15;
    const tickMinutes = Number(tickMinutesRaw);
    if (!Number.isFinite(tickMinutes) || tickMinutes <= 0) {
      throw new Error('time.tickMinutes must be a positive number.');
    }

    const defaultBoundaries = {
      dawn: 360,
      day: 480,
      dusk: 1080,
      night: 1200
    };
    const boundarySource = source?.segmentBoundaries ?? defaultBoundaries;
    if (!boundarySource || typeof boundarySource !== 'object' || Array.isArray(boundarySource)) {
      throw new Error('time.segmentBoundaries must be an object mapping segment names to minute offsets.');
    }

    const boundaries = [];
    const seen = new Set();
    for (const [rawName, rawMinute] of Object.entries(boundarySource)) {
      if (typeof rawName !== 'string' || !rawName.trim()) {
        throw new Error('time.segmentBoundaries contains an empty segment name.');
      }
      const name = rawName.trim();
      const key = name.toLowerCase();
      if (seen.has(key)) {
        throw new Error(`time.segmentBoundaries contains duplicate segment name "${name}".`);
      }
      seen.add(key);

      const minuteValue = Number(rawMinute);
      if (!Number.isFinite(minuteValue) || minuteValue < 0 || minuteValue >= cycleLengthMinutes) {
        throw new Error(`time.segmentBoundaries.${name} must be a number between 0 and cycleLengthMinutes - 1.`);
      }

      boundaries.push({
        name,
        startMinute: minuteValue,
        startHour: minuteValue / 60
      });
    }

    if (!boundaries.length) {
      throw new Error('time.segmentBoundaries must define at least one segment.');
    }

    boundaries.sort((a, b) => a.startMinute - b.startMinute);

    return {
      cycleLengthMinutes,
      cycleLengthHours: cycleLengthMinutes / 60,
      tickMinutes,
      tickHours: tickMinutes / 60,
      segmentBoundaries: boundaries
    };
  }

  static #normalizeCalendarDefinition(definition) {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
      throw new Error('Calendar definition must be an object.');
    }

    const yearName = typeof definition.yearName === 'string' && definition.yearName.trim()
      ? definition.yearName.trim()
      : 'Common Reckoning';

    if (!Array.isArray(definition.months) || !definition.months.length) {
      throw new Error('Calendar definition must include at least one month.');
    }
    const months = definition.months.map((month, index) => {
      if (!month || typeof month !== 'object' || Array.isArray(month)) {
        throw new Error(`Calendar month ${index + 1} must be an object.`);
      }
      const name = typeof month.name === 'string' && month.name.trim()
        ? month.name.trim()
        : null;
      if (!name) {
        throw new Error(`Calendar month ${index + 1} is missing a name.`);
      }
      const lengthDays = Number(month.lengthDays);
      if (!Number.isFinite(lengthDays) || lengthDays <= 0 || !Number.isInteger(lengthDays)) {
        throw new Error(`Calendar month "${name}" must have a positive integer lengthDays.`);
      }
      const seasonName = typeof month.seasonName === 'string' && month.seasonName.trim()
        ? month.seasonName.trim()
        : null;
      return { name, lengthDays, seasonName };
    });

    if (!Array.isArray(definition.weekdays) || !definition.weekdays.length) {
      throw new Error('Calendar definition must include at least one weekday.');
    }
    const weekdays = definition.weekdays.map((weekday, index) => {
      if (typeof weekday !== 'string' || !weekday.trim()) {
        throw new Error(`Calendar weekday ${index + 1} must be a non-empty string.`);
      }
      return weekday.trim();
    });

    let seasons = [];
    if (Array.isArray(definition.seasons) && definition.seasons.length) {
      seasons = definition.seasons.map((season, index) => {
        if (!season || typeof season !== 'object' || Array.isArray(season)) {
          throw new Error(`Calendar season ${index + 1} must be an object.`);
        }
        const name = typeof season.name === 'string' && season.name.trim()
          ? season.name.trim()
          : null;
        if (!name) {
          throw new Error(`Calendar season ${index + 1} is missing a name.`);
        }
        const startMonth = typeof season.startMonth === 'string' && season.startMonth.trim()
          ? season.startMonth.trim()
          : null;
        const startDay = Number.isFinite(Number(season.startDay))
          ? Number(season.startDay)
          : 1;
        const dayLengthMinutes = Number.isFinite(Number(season.dayLengthMinutes))
          ? Number(season.dayLengthMinutes)
          : null;
        const description = typeof season.description === 'string' && season.description.trim()
          ? season.description.trim()
          : null;
        return {
          name,
          description,
          startMonth,
          startDay,
          dayLengthMinutes
        };
      });
    } else {
      const seasonNames = Array.from(new Set(months.map(month => month.seasonName).filter(Boolean)));
      seasons = seasonNames.map(name => ({
        name,
        description: null,
        startMonth: months.find(month => month.seasonName === name)?.name || null,
        startDay: 1,
        dayLengthMinutes: null
      }));
    }

    const holidays = Array.isArray(definition.holidays)
      ? definition.holidays
        .map((holiday) => {
          if (!holiday || typeof holiday !== 'object' || Array.isArray(holiday)) {
            return null;
          }
          const name = typeof holiday.name === 'string' && holiday.name.trim()
            ? holiday.name.trim()
            : null;
          if (!name) {
            return null;
          }
          const month = typeof holiday.month === 'string' && holiday.month.trim()
            ? holiday.month.trim()
            : null;
          const day = Number.isFinite(Number(holiday.day)) ? Number(holiday.day) : null;
          const description = typeof holiday.description === 'string' && holiday.description.trim()
            ? holiday.description.trim()
            : null;
          return {
            name,
            description,
            month,
            day
          };
        })
        .filter(Boolean)
      : [];

    return {
      yearName,
      months,
      weekdays,
      seasons,
      holidays
    };
  }

  static generateCalendarDefinition({ settingName = null } = {}) {
    const monthNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December'
    ];
    const monthLengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const monthSeasons = [
      'Winter', 'Winter', 'Spring',
      'Spring', 'Spring', 'Summer',
      'Summer', 'Summer', 'Autumn',
      'Autumn', 'Autumn', 'Winter'
    ];

    const months = monthNames.map((name, index) => ({
      name,
      lengthDays: monthLengths[index],
      seasonName: monthSeasons[index]
    }));

    const calendar = {
      yearName: 'Common Era',
      months,
      weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      seasons: [
        {
          name: 'Winter',
          description: 'Cold weather, long nights, and quieter roads as people stay close to shelter and heat.',
          startMonth: 'December',
          startDay: 1,
          dayLengthMinutes: null
        },
        {
          name: 'Spring',
          description: 'Mild rain, fresh growth, and renewed travel as markets and communities become busier.',
          startMonth: 'March',
          startDay: 1,
          dayLengthMinutes: null
        },
        {
          name: 'Summer',
          description: 'Warm to hot days, high activity, and long daylight hours favorable to travel and work.',
          startMonth: 'June',
          startDay: 1,
          dayLengthMinutes: null
        },
        {
          name: 'Autumn',
          description: 'Cooling air, harvest routines, and shorter days as settlements prepare for winter.',
          startMonth: 'September',
          startDay: 1,
          dayLengthMinutes: null
        }
      ],
      holidays: [
        {
          name: 'New Year\'s Day',
          description: 'The first day of the year, marked by resolutions, public gatherings, and ceremonial toasts.',
          month: 'January',
          day: 1
        },
        {
          name: 'Deep Winter Vigil',
          description: 'A night of lanterns and shared fires held to endure the harshest stretch of winter.',
          month: 'January',
          day: 20
        },
        {
          name: 'Vernal Eve',
          description: 'A celebration of spring\'s arrival with planting rites and bright decorations.',
          month: 'March',
          day: 20
        },
        {
          name: 'Founders\' Day',
          description: 'Communities honor their origins with speeches, local histories, and civic festivals.',
          month: 'April',
          day: 15
        },
        {
          name: 'Midspring Fair',
          description: 'Trade stalls, games, and performances draw crowds for a week of commerce and leisure.',
          month: 'May',
          day: 1
        },
        {
          name: 'High Sun Festival',
          description: 'The longest-day celebration features outdoor feasts, competitions, and music.',
          month: 'June',
          day: 21
        },
        {
          name: 'Harvest Oath',
          description: 'Farmers and merchants mark the main harvest with vows, contracts, and gratitude rites.',
          month: 'September',
          day: 22
        },
        {
          name: 'Remembering Night',
          description: 'People honor the dead and absent with quiet offerings, stories, and candlelit walks.',
          month: 'October',
          day: 31
        },
        {
          name: 'First Frost Market',
          description: 'A seasonal market opens as cold weather settles in, focusing on storage goods and winter wares.',
          month: 'November',
          day: 15
        },
        {
          name: 'Year\'s End',
          description: 'The final day of the year is kept with reflection, debts settled, and midnight celebrations.',
          month: 'December',
          day: 31
        }
      ]
    };

    return Globals.#normalizeCalendarDefinition(calendar);
  }

  static #resolveDefaultStartHour() {
    const timeConfig = Globals.getTimeConfig();
    const daySegment = timeConfig.segmentBoundaries.find(
      segment => segment.name.trim().toLowerCase() === 'day'
    );
    return daySegment ? daySegment.startHour : timeConfig.segmentBoundaries[0].startHour;
  }

  static #normalizeWorldTime(value, { allowNull = false } = {}) {
    if (value === null || value === undefined) {
      if (allowNull) {
        return null;
      }
      throw new Error('World time must be provided.');
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('World time must be an object.');
    }

    const rawDayIndex = Number(value.dayIndex);
    if (!Number.isFinite(rawDayIndex) || rawDayIndex < 0) {
      throw new Error('worldTime.dayIndex must be a non-negative number.');
    }

    const rawTimeHours = Number(value.timeHours);
    if (!Number.isFinite(rawTimeHours) || rawTimeHours < 0) {
      throw new Error('worldTime.timeHours must be a non-negative number.');
    }

    const timeConfig = Globals.getTimeConfig();
    const cycleLengthHours = timeConfig.cycleLengthHours;
    const totalHours = rawDayIndex * cycleLengthHours + rawTimeHours;
    const normalizedDayIndex = Math.floor(totalHours / cycleLengthHours);
    const normalizedTimeHours = totalHours - (normalizedDayIndex * cycleLengthHours);

    return {
      dayIndex: normalizedDayIndex,
      timeHours: normalizedTimeHours
    };
  }

  static ensureWorldTimeInitialized({ settingName = null } = {}) {
    if (!Globals.calendarDefinition) {
      Globals.calendarDefinition = Globals.generateCalendarDefinition({ settingName });
    } else {
      Globals.calendarDefinition = Globals.#normalizeCalendarDefinition(Globals.calendarDefinition);
    }

    if (!Globals.worldTime) {
      Globals.worldTime = {
        dayIndex: 0,
        timeHours: Globals.#resolveDefaultStartHour()
      };
    } else {
      Globals.worldTime = Globals.#normalizeWorldTime(Globals.worldTime);
    }

    return Globals.getWorldTimeContext({ skipEnsure: true });
  }

  static resetWorldTime({ settingName = null, calendarDefinition = null } = {}) {
    if (calendarDefinition !== null && calendarDefinition !== undefined) {
      Globals.calendarDefinition = Globals.#normalizeCalendarDefinition(calendarDefinition);
    } else {
      Globals.calendarDefinition = Globals.generateCalendarDefinition({ settingName });
    }
    Globals.worldTime = {
      dayIndex: 0,
      timeHours: Globals.#resolveDefaultStartHour()
    };
    Globals.syncWorldTimeToPlayer();
    return Globals.getWorldTimeContext();
  }

  static hydrateWorldTime({
    worldTime = null,
    calendarDefinition = null,
    settingName = null
  } = {}) {
    if (calendarDefinition !== null && calendarDefinition !== undefined) {
      Globals.calendarDefinition = Globals.#normalizeCalendarDefinition(calendarDefinition);
    } else if (!Globals.calendarDefinition) {
      Globals.calendarDefinition = Globals.generateCalendarDefinition({ settingName });
    } else {
      Globals.calendarDefinition = Globals.#normalizeCalendarDefinition(Globals.calendarDefinition);
    }

    if (worldTime !== null && worldTime !== undefined) {
      Globals.worldTime = Globals.#normalizeWorldTime(worldTime);
    } else if (!Globals.worldTime) {
      Globals.worldTime = {
        dayIndex: 0,
        timeHours: Globals.#resolveDefaultStartHour()
      };
    } else {
      Globals.worldTime = Globals.#normalizeWorldTime(Globals.worldTime);
    }

    Globals.syncWorldTimeToPlayer();
    return Globals.getWorldTimeContext();
  }

  static getSerializedWorldTime() {
    Globals.ensureWorldTimeInitialized();
    return Globals.#deepClone(Globals.worldTime);
  }

  static getSerializedCalendarDefinition() {
    Globals.ensureWorldTimeInitialized();
    return Globals.#deepClone(Globals.calendarDefinition);
  }

  static getTotalWorldHours() {
    Globals.ensureWorldTimeInitialized();
    const timeConfig = Globals.getTimeConfig();
    return Globals.worldTime.dayIndex * timeConfig.cycleLengthHours + Globals.worldTime.timeHours;
  }

  static syncWorldTimeToPlayer(player = Globals.currentPlayer) {
    if (!player || typeof player !== 'object') {
      return;
    }
    if (typeof player.isNPC === 'boolean' && player.isNPC) {
      return;
    }
    if (typeof player.elapsedTime === 'number' || typeof player.elapsedTime === 'undefined') {
      player.elapsedTime = Globals.getTotalWorldHours();
    }
  }

  static getCalendarDate(worldTime = Globals.worldTime, { skipEnsure = false } = {}) {
    if (!skipEnsure) {
      Globals.ensureWorldTimeInitialized();
    }
    const normalizedWorldTime = Globals.#normalizeWorldTime(worldTime);
    const calendar = Globals.calendarDefinition;

    const totalDaysInYear = calendar.months.reduce((total, month) => total + month.lengthDays, 0);
    if (!Number.isFinite(totalDaysInYear) || totalDaysInYear <= 0) {
      throw new Error('Calendar months define an invalid total day count.');
    }

    const year = Math.floor(normalizedWorldTime.dayIndex / totalDaysInYear) + 1;
    let dayOfYear = normalizedWorldTime.dayIndex % totalDaysInYear;
    let month = calendar.months[0];
    for (const candidate of calendar.months) {
      if (dayOfYear < candidate.lengthDays) {
        month = candidate;
        break;
      }
      dayOfYear -= candidate.lengthDays;
    }

    const weekdayIndex = normalizedWorldTime.dayIndex % calendar.weekdays.length;
    const weekday = calendar.weekdays[weekdayIndex];
    const dayOfMonth = dayOfYear + 1;
    const seasonName = month.seasonName
      || calendar.seasons.find(season => season.startMonth === month.name)?.name
      || 'Unknown Season';
    const seasonDefinition = calendar.seasons.find((season) => {
      if (!season || typeof season.name !== 'string') {
        return false;
      }
      return season.name.trim().toLowerCase() === seasonName.trim().toLowerCase();
    }) || null;
    const seasonDescription = seasonDefinition?.description || null;
    const holidayDefinition = calendar.holidays.find((holiday) => {
      if (!holiday || typeof holiday !== 'object') {
        return false;
      }
      const holidayMonth = typeof holiday.month === 'string' ? holiday.month.trim() : '';
      const holidayDay = Number(holiday.day);
      if (!holidayMonth || !Number.isFinite(holidayDay)) {
        return false;
      }
      return holidayMonth.toLowerCase() === month.name.trim().toLowerCase()
        && holidayDay === dayOfMonth;
    }) || null;
    const holiday = holidayDefinition
      ? {
          name: holidayDefinition.name,
          description: holidayDefinition.description || null,
          month: holidayDefinition.month || month.name,
          day: Number.isFinite(Number(holidayDefinition.day)) ? Number(holidayDefinition.day) : dayOfMonth
        }
      : null;

    return {
      year,
      monthName: month.name,
      dayOfMonth,
      weekday,
      seasonName,
      seasonDescription,
      holiday
    };
  }

  static getTimeSegment(worldTime = Globals.worldTime, { skipEnsure = false } = {}) {
    if (!skipEnsure) {
      Globals.ensureWorldTimeInitialized();
    }
    const normalizedWorldTime = Globals.#normalizeWorldTime(worldTime);
    const timeConfig = Globals.getTimeConfig();
    const minute = normalizedWorldTime.timeHours * 60;

    let currentSegment = timeConfig.segmentBoundaries[timeConfig.segmentBoundaries.length - 1];
    for (const segment of timeConfig.segmentBoundaries) {
      if (minute >= segment.startMinute) {
        currentSegment = segment;
      } else {
        break;
      }
    }

    return currentSegment.name;
  }

  static getSeason(worldTime = Globals.worldTime) {
    return Globals.getCalendarDate(worldTime).seasonName;
  }

  static formatTime(worldTime = Globals.worldTime, { skipEnsure = false } = {}) {
    if (!skipEnsure) {
      Globals.ensureWorldTimeInitialized();
    }
    const normalizedWorldTime = Globals.#normalizeWorldTime(worldTime);
    const totalMinutes = Math.round(normalizedWorldTime.timeHours * 60);
    const hour = Math.floor(totalMinutes / 60) % 24;
    const minute = ((totalMinutes % 60) + 60) % 60;
    const paddedHour = String(hour).padStart(2, '0');
    const paddedMinute = String(minute).padStart(2, '0');
    return `${paddedHour}:${paddedMinute}`;
  }

  static formatDate(worldTime = Globals.worldTime, { skipEnsure = false } = {}) {
    if (!skipEnsure) {
      Globals.ensureWorldTimeInitialized();
    }
    const date = Globals.getCalendarDate(worldTime, { skipEnsure: true });
    return `${date.weekday}, ${date.monthName} ${date.dayOfMonth}, ${Globals.calendarDefinition.yearName} ${date.year}`;
  }

  static getLightingDescription(segmentName = '') {
    const normalized = typeof segmentName === 'string' ? segmentName.trim().toLowerCase() : '';
    switch (normalized) {
      case 'dawn':
        return 'Low dawn light with long shadows and improving visibility.';
      case 'day':
        return 'Bright daylight with clear visibility.';
      case 'dusk':
        return 'Fading evening light with reduced visibility.';
      case 'night':
        return 'Dark nighttime conditions with poor natural visibility.';
      default:
        return `Ambient light associated with ${segmentName || 'the current time segment'}.`;
    }
  }

  static getWorldTimeContext({ transitions = [], skipEnsure = false } = {}) {
    if (!skipEnsure) {
      Globals.ensureWorldTimeInitialized();
    }
    const worldTime = Globals.#normalizeWorldTime(Globals.worldTime);
    const segment = Globals.getTimeSegment(worldTime, { skipEnsure: true });
    const date = Globals.getCalendarDate(worldTime, { skipEnsure: true });
    const context = {
      dayIndex: worldTime.dayIndex,
      timeHours: Number(worldTime.timeHours.toFixed(4)),
      segment,
      season: date.seasonName,
      seasonDescription: date.seasonDescription || null,
      timeLabel: Globals.formatTime(worldTime, { skipEnsure: true }),
      dateLabel: Globals.formatDate(worldTime, { skipEnsure: true }),
      lighting: Globals.getLightingDescription(segment),
      holiday: date.holiday ? { ...date.holiday } : null,
      holidayName: date.holiday?.name || null,
      holidayDescription: date.holiday?.description || null,
      date
    };

    if (Array.isArray(transitions) && transitions.length) {
      context.transitions = transitions.map((entry) => ({ ...entry }));
    }

    return context;
  }

  static advanceTime(hours, { source = 'turn' } = {}) {
    const amount = Number(hours);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('Globals.advanceTime requires a non-negative numeric hour amount.');
    }

    Globals.ensureWorldTimeInitialized();

    const before = Globals.getWorldTimeContext();
    if (amount === 0) {
      return {
        source,
        advancedHours: 0,
        transitions: [],
        previous: before,
        current: before
      };
    }

    const timeConfig = Globals.getTimeConfig();
    const totalHours = Globals.getTotalWorldHours() + amount;
    const dayIndex = Math.floor(totalHours / timeConfig.cycleLengthHours);
    const timeHours = totalHours - (dayIndex * timeConfig.cycleLengthHours);

    Globals.worldTime = Globals.#normalizeWorldTime({ dayIndex, timeHours });
    Globals.syncWorldTimeToPlayer();

    const after = Globals.getWorldTimeContext();
    const transitions = [];
    if (before.segment !== after.segment) {
      transitions.push({
        type: 'segment',
        from: before.segment,
        to: after.segment,
        atDayIndex: after.dayIndex,
        atTimeHours: after.timeHours
      });
    }
    if (before.season !== after.season) {
      transitions.push({
        type: 'season',
        from: before.season,
        to: after.season,
        atDayIndex: after.dayIndex,
        atTimeHours: after.timeHours
      });
    }

    return {
      source,
      advancedHours: amount,
      transitions,
      previous: before,
      current: after
    };
  }

  static setSaveMetadata(metadata) {
    if (metadata === null || metadata === undefined) {
      Globals.saveMetadata = null;
      return;
    }
    if (typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new Error('Globals.setSaveMetadata requires a metadata object or null.');
    }
    Globals.saveMetadata = metadata;
  }

  static getSaveMetadata() {
    return Globals.saveMetadata;
  }

  static setCurrentSaveInfo(info) {
    if (info === null || info === undefined) {
      Globals.currentSaveInfo = null;
      return;
    }
    if (typeof info !== 'object' || Array.isArray(info)) {
      throw new Error('Globals.setCurrentSaveInfo requires an info object or null.');
    }
    Globals.currentSaveInfo = info;
  }

  static getCurrentSaveInfo() {
    return Globals.currentSaveInfo;
  }

  static getBasePromptContext = function () {
    throw new Error('Globals.getBasePromptContext called before being set.');
  }

  static getPromptEnv = function () {
    throw new Error('Globals.getPromptEnv called before being set.');
  }

  static parseXMLTemplate = function () {
    throw new Error('Globals.parseXMLTemplate called before being set.');
  }

  static getSceneSummaries() {
    if (!Globals.sceneSummaries) {
      throw new Error('Globals.sceneSummaries accessed before being initialized.');
    }
    return Globals.sceneSummaries;
  }

  static get currentPlayer() {
    const Player = require('./Player.js');
    if (Globals.#currentPlayerOverride) {
      return Globals.#currentPlayerOverride;
    }
    return typeof Player.getCurrentPlayer === 'function'
      ? Player.getCurrentPlayer()
      : null;
  }

  static set currentPlayer(player) {
    const Player = require('./Player.js');
    Globals.#currentPlayerOverride = player || null;
    if (typeof Player.setCurrentPlayerResolver === 'function') {
      Player.setCurrentPlayerResolver(() => Globals.#currentPlayerOverride);
    }
  }

  static set processedMove(value) {
    //console.log(`Globals.processedMove set to ${value}`);
    //console.trace();
    Globals._processedMove = value;
  }

  static get processedMove() {
    //console.log(`Globals.processedMove accessed, value is ${Globals._processedMove}`);
    return Globals._processedMove;
  }

  static setInCombat(value) {
    //console.log(`Globals.setInCombat(${value}) called.`);
    Globals.inCombat = value;
  }

  static isInCombat() {
    //console.log(`Globals.isInCombat() => ${Globals.inCombat}`);
    return Globals.inCombat;
  }

  static get location() {
    const player = Globals.currentPlayer;
    return player?.location || null;
  }

  static get region() {
    const player = Globals.currentPlayer;
    return player?.location?.region || null;
  }

  static get elapsedTime() {
    const player = Globals.currentPlayer;
    if (player) {
      return player.elapsedTime ?? 0;
    }
    return Globals.getTotalWorldHours();
  }

  static set elapsedTime(value) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error('Globals.elapsedTime must be set to a non-negative number.');
    }
    const player = Globals.currentPlayer;
    if (player) {
      player.elapsedTime = value;
    }
    Globals.ensureWorldTimeInitialized();
    const timeConfig = Globals.getTimeConfig();
    const dayIndex = Math.floor(value / timeConfig.cycleLengthHours);
    const timeHours = value - (dayIndex * timeConfig.cycleLengthHours);
    Globals.worldTime = Globals.#normalizeWorldTime({ dayIndex, timeHours });
  }

  static locationById(id) {
    if (!Globals.config) {
      console.warn('Globals.locationById accessed before config was set.');
      console.trace();
      return null;
    }
    const Location = require('./Location.js');
    return Location.get(id);
  }

  static regionsById(id) {
    if (!Globals.config) {
      console.warn('Globals.regionsById accessed before config was set.');
      console.trace();
      return null;
    }
    const Region = require('./Region.js');
    return Region.get(id);
  }

  static get locationsById() {
    if (!Globals.config) {
      console.warn('Globals.locationsById accessed before config was set.');
      console.trace();
      return new Map();
    }

    const Location = require('./Location.js');
    return Location.indexById;
  }

  static get regionsById() {
    if (!Globals.config) {
      console.warn('Globals.regionsById accessed before config was set.');
      console.trace();
      return new Map();
    }

    const Region = require('./Region.js');
    return Region.indexById;
  }

  static get locationsByName() {
    if (!Globals.config) {
      console.warn('Globals.locationsByName accessed before config was set.');
      console.trace();
      return new Map();
    }

    const Location = require('./Location.js');
    return Location.indexByName;
  }

  static get regionsByName() {
    if (!Globals.config) {
      console.warn('Globals.regionsByName accessed before config was set.');
      console.trace();
      return new Map();
    }

    const Region = require('./Region.js');
    return Region.indexByName;
  }

  static get playersById() {
    if (!Globals.config) {
      console.warn('Globals.playersById accessed before config was set.');
      console.trace();
      return new Map();
    }

    const Player = require('./Player.js');
    return Player.indexById;
  }

  static get playersByName() {
    if (!Globals.config) {
      console.warn('Globals.playersByName accessed before config was set.');
      console.trace();
      return new Map();
    }

    const Player = require('./Player.js');
    return Player.indexByName;
  }

  static emitToClient(clientId, type, payload = {}, options = {}) {
    const hub = Globals.realtimeHub;
    if (!hub || typeof hub.emit !== 'function') {
      throw new Error('Globals.emitToClient called before realtimeHub was initialized.');
    }

    const normalizedType = typeof type === 'string' ? type.trim() : '';
    if (!normalizedType) {
      throw new Error('Globals.emitToClient requires a non-empty event type.');
    }

    const hasClientId = clientId !== undefined && clientId !== null;
    let normalizedClientId = null;
    if (hasClientId) {
      if (typeof clientId !== 'string') {
        throw new TypeError('Globals.emitToClient expects clientId to be a string when provided.');
      }
      normalizedClientId = clientId.trim();
      if (!normalizedClientId) {
        throw new Error('Globals.emitToClient received an empty clientId string.');
      }
    }

    const includeServerTime = options?.includeServerTime !== false;
    const requestId = typeof options?.requestId === 'string' ? options.requestId.trim() : null;

    let payloadEnvelope;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      payloadEnvelope = { ...payload };
    } else {
      payloadEnvelope = { value: payload };
    }

    if (includeServerTime && !Object.prototype.hasOwnProperty.call(payloadEnvelope, 'serverTime')) {
      payloadEnvelope.serverTime = new Date().toISOString();
    }

    if (requestId && !Object.prototype.hasOwnProperty.call(payloadEnvelope, 'requestId')) {
      payloadEnvelope.requestId = requestId;
    }

    return Boolean(hub.emit(normalizedClientId, normalizedType, payloadEnvelope));
  }

  static updateSpinnerText({
    clientId = null,
    message = 'Loading...',
    scope = 'chat',
    requestId = null,
    includeServerTime = true
  } = {}) {
    const normalizedMessage = typeof message === 'string' && message.trim()
      ? message.trim()
      : 'Loading...';

    const payload = {
      stage: 'spinner:update',
      message: normalizedMessage,
      scope
    };

    if (requestId && typeof requestId === 'string' && requestId.trim()) {
      payload.requestId = requestId.trim();
    }

    return Globals.emitToClient(clientId, 'chat_status', payload, {
      includeServerTime
    });
  }
}

module.exports = Globals;
