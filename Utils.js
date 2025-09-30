const { DOMParser, XMLSerializer } = require('xmldom');

class Utils {
  static intersection = (setA, setB) => new Set([...setA].filter(x => setB.has(x)));
  static difference = (setA, setB) => new Set([...setA].filter(x => !setB.has(x)));
  static union = (setA, setB) => new Set([...setA, ...setB]);
  static innerXML(node) {
    const s = new XMLSerializer();
    return Array.from(node.childNodes).map(n => s.serializeToString(n)).join('');
  }

  /* Capitalizes the first letter of each word in a string, except for small words that aren't supposed to be capitalized in titles (like "and", "the", "of", etc.), unless they are the first or last word. */
  static capitalizeProperNoun(str) {
    const smallWords = [
      "and", "the", "of", "in", "on", "at", "to", "for", "by", "with", "a", "an", "but", "or", "nor", "as", "from", "with"
    ];
    if (!str || typeof str !== "string") return "";
    const words = str.split(/\s+/);
    return words
      .map((word, idx) => {
        const lower = word.toLowerCase();
        if (
          idx !== 0 &&
          idx !== words.length - 1 &&
          smallWords.includes(lower)
        ) {
          return lower;
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(" ");
  }

  static getAllNPCIds
}

module.exports = Utils;