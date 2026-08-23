const { AgentActionType, validateAgentAction } = require('../../../shared/src');

class ActionRegistry {
  constructor() {
    this.handlers = new Map();
  }

  register(actionType, handler) {
    if (!Object.values(AgentActionType).includes(actionType)) {
      throw new Error(`Unknown action type: ${actionType}`);
    }

    if (typeof handler !== 'function') {
      throw new Error(`Handler for ${actionType} must be a function`);
    }

    this.handlers.set(actionType, handler);
  }

  has(actionType) {
    return this.handlers.has(actionType);
  }

  async execute(action, context = {}) {
    validateAgentAction(action);

    const handler = this.handlers.get(action.type);
    if (!handler) {
      throw new Error(`No handler registered for ${action.type}`);
    }

    return handler(action.payload, context);
  }
}

module.exports = {
  ActionRegistry
};
