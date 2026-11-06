/** Update one literal text node incrementally so native DOM Range selection survives. */
export function updateSelectableText(output, nextText, update = null) {
    const view = output?.ownerDocument?.defaultView;
    if (!view || !(output instanceof view.HTMLElement) || typeof nextText !== 'string') {
        throw new Error('Selectable text rendering requires an output element and string text.');
    }
    const currentText = output.textContent || '';
    if (currentText === nextText) {
        return false;
    }

    const textNode = output.childNodes.length === 1
        && output.firstChild?.nodeType === view.Node.TEXT_NODE
        ? output.firstChild
        : null;
    const canApplyDelta = update
        && update.reset !== true
        && typeof update.previousText === 'string'
        && typeof update.appendedText === 'string'
        && typeof update.nextText === 'string'
        && update.nextText === nextText
        && currentText === update.previousText
        && textNode;

    if (!textNode) {
        if (output.childNodes.length > 0) {
            throw new Error('Selectable text output must contain at most one text node.');
        }
        output.appendChild(output.ownerDocument.createTextNode(nextText));
        return true;
    }

    if (canApplyDelta) {
        if (update.appendedText) {
            textNode.appendData(update.appendedText);
        }
        const removedPrefixLength = textNode.length - nextText.length;
        if (removedPrefixLength > 0) {
            textNode.deleteData(0, removedPrefixLength);
        }
    } else {
        let commonPrefixLength = 0;
        while (
            commonPrefixLength < currentText.length
            && commonPrefixLength < nextText.length
            && currentText[commonPrefixLength] === nextText[commonPrefixLength]
        ) {
            commonPrefixLength += 1;
        }
        let commonSuffixLength = 0;
        while (
            commonSuffixLength < currentText.length - commonPrefixLength
            && commonSuffixLength < nextText.length - commonPrefixLength
            && currentText[currentText.length - 1 - commonSuffixLength]
                === nextText[nextText.length - 1 - commonSuffixLength]
        ) {
            commonSuffixLength += 1;
        }
        textNode.replaceData(
            commonPrefixLength,
            currentText.length - commonPrefixLength - commonSuffixLength,
            nextText.slice(commonPrefixLength, nextText.length - commonSuffixLength)
        );
    }
    if (textNode.data !== nextText) {
        throw new Error('Incremental selectable text update did not match the requested text.');
    }
    return true;
}
