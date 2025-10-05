const DEFAULT_LOG_PREFIX = '📊 AI metrics';

function attachAxiosMetricsLogger(axiosInstance, { logPrefix = DEFAULT_LOG_PREFIX } = {}) {
  if (!axiosInstance || typeof axiosInstance.interceptors?.request?.use !== 'function') {
    return;
  }

  if (axiosInstance.__aiMetricsLoggerAttached) {
    return;
  }

  axiosInstance.interceptors.request.use((config) => {
    if (config) {
      config.metadata = config.metadata || {};
      config.metadata.__aiMetricsStart = Date.now();
    }
    return config;
  });

  const logMetrics = (response, { isError = false } = {}) => {
    if (!response || !response.config) {
      return;
    }

    const usage = response.data?.usage || {};
    const totalTokens = Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : null;
    const cachedTokensCandidate = usage.cached_tokens ?? usage.prompt_tokens_cached ?? usage.prompt_tokens_cache ?? null;
    const cachedTokens = Number.isFinite(Number(cachedTokensCandidate)) ? Number(cachedTokensCandidate) : null;

    const start = response.config.metadata?.__aiMetricsStart || null;
    const durationMs = start ? Date.now() - start : null;
    const durationSeconds = durationMs ? durationMs / 1000 : null;
    const tps = (totalTokens !== null && durationSeconds && durationSeconds > 0)
      ? (totalTokens / durationSeconds).toFixed(2)
      : null;

    const url = response.config.url || response.config.baseURL || 'unknown-endpoint';
    const method = (response.config.method || 'GET').toUpperCase();

    const parts = [
      isError ? '⚠️ AI metrics (error)' : logPrefix,
      `${method} ${url}`
    ];

    if (totalTokens !== null) {
      parts.push(`total=${totalTokens}`);
    }

    if (cachedTokens !== null && cachedTokens > 0) {
      parts.push(`cached=${cachedTokens}`);
    }

    if (tps) {
      parts.push(`tps=${tps}`);
    }

    if (durationSeconds) {
      parts.push(`duration=${durationSeconds.toFixed(2)}s`);
    }

    if (parts.length > 2) {
      console.log(parts.join(' | '));
    }
  };

  axiosInstance.interceptors.response.use((response) => {
    try {
      logMetrics(response, { isError: false });
    } catch (_) {
      // ignore logging failures
    }
    return response;
  }, (error) => {
    try {
      if (error && error.response) {
        logMetrics(error.response, { isError: true });
      }
    } catch (_) {
      // ignore logging failures
    }
    return Promise.reject(error);
  });

  axiosInstance.__aiMetricsLoggerAttached = true;
}

module.exports = attachAxiosMetricsLogger;
