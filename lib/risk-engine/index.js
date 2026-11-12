'use strict';

// Public entry point. Binds the frozen V1 rule set, including its reviewed-producer list (empty in V1),
// so no caller can widen which producers may assert a positive or negative finding.
const { RULES } = require('./rules');
const engine = require('./engine');

const evaluateRisk = input => engine.evaluate(input, RULES);

module.exports = { evaluateRisk, SCHEMA_VERSION: engine.SCHEMA_VERSION, STATUSES: engine.STATUSES, MAX_RECORDS: engine.MAX_RECORDS };
