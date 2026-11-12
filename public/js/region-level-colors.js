(function (root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  else root.RegionLevelColors = exported;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';

  const stops = [
    { difference: -5, rgb: [59, 130, 246] },
    { difference: -2.5, rgb: [34, 197, 94] },
    { difference: 0, rgb: [250, 204, 21] },
    { difference: 2.5, rgb: [249, 115, 22] },
    { difference: 5, rgb: [239, 68, 68] }
  ];

  function getRegionColors(regionLevel, playerLevel) {
    const levelDifference = Number.isFinite(regionLevel) && Number.isFinite(playerLevel)
      ? regionLevel - playerLevel : null;
    let rgb = [148, 163, 184];
    if (levelDifference !== null) {
      if (levelDifference <= stops[0].difference) rgb = stops[0].rgb;
      else if (levelDifference >= stops[stops.length - 1].difference) rgb = stops[stops.length - 1].rgb;
      else {
        const upperIndex = stops.findIndex(stop => stop.difference > levelDifference);
        const lower = stops[upperIndex - 1];
        const upper = stops[upperIndex];
        const fraction = (levelDifference - lower.difference) / (upper.difference - lower.difference);
        rgb = lower.rgb.map((channel, index) => Math.round(channel + (upper.rgb[index] - channel) * fraction));
      }
    }
    const channels = rgb.join(', ');
    return {
      levelDifference,
      fill: `rgb(${channels})`,
      border: `rgb(${channels})`,
      bubbleFill: `rgba(${channels}, 0.18)`,
      labelBackground: `rgba(${channels}, 0.55)`,
      labelOutline: 'rgba(8, 15, 23, 0.9)',
      labelTextColor: '#e0f2fe'
    };
  }

  function capturePlayerSnapshot(player) {
    const playerId = player?.isNPC !== true && typeof player?.id === 'string' ? player.id : null;
    return { playerId, playerLevel: playerId && Number.isFinite(player.level) ? player.level : null };
  }

  function resolvePlayerLevel(map, playerAtRequest, latestPlayer) {
    const latest = capturePlayerSnapshot(latestPlayer);
    if (playerAtRequest && playerAtRequest.playerId !== latest.playerId && latest.playerId !== map.playerId) return null;
    if (map.playerId && latest.playerId === map.playerId
      && (playerAtRequest?.playerId !== latest.playerId || playerAtRequest.playerLevel !== latest.playerLevel)) {
      return latest.playerLevel;
    }
    return Number.isFinite(map.playerLevel) ? map.playerLevel : null;
  }

  return { getRegionColors, capturePlayerSnapshot, resolvePlayerLevel };
});
