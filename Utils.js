const { DOMParser, XMLSerializer } = require('xmldom');

class Utils {
  static intersection = (setA, setB) => new Set([...setA].filter(x => setB.has(x)));
  static difference = (setA, setB) => new Set([...setA].filter(x => !setB.has(x)));
  static union = (setA, setB) => new Set([...setA, ...setB]);
  static innerXML(node) {
    const s = new XMLSerializer();
    return Array.from(node.childNodes).map(n => s.serializeToString(n)).join('');
  }

  static getAllNPCIds
}

module.exports = Utils;