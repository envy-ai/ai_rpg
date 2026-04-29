function addEvalFilter(env) {
    if (!env || typeof env.addFilter !== "function") {
        throw new Error("addEvalFilter requires a Nunjucks environment.");
    }
    if (typeof env.renderString !== "function") {
        throw new Error("addEvalFilter requires an environment with renderString.");
    }

    env.addFilter("eval", function (str, locals = undefined) {
        const template = str === undefined || str === null ? "" : String(str);
        const baseContext = this && this.ctx && typeof this.ctx === "object"
            ? this.ctx
            : {};

        if (locals !== undefined && (locals === null || typeof locals !== "object")) {
            throw new Error("eval filter locals must be an object when provided.");
        }

        const renderContext = locals === undefined
            ? baseContext
            : { ...baseContext, ...locals };

        return env.renderString(template, renderContext);
    });
}

module.exports = {
    addEvalFilter,
};
