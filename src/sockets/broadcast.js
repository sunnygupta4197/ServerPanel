// Shared real-time broadcast helpers, usable from any route file the same
// way src/jobs/jobQueue.js is — call setIO(io) once at startup, then import
// and call the broadcast* functions directly from route handlers.
let io = null;

function setIO(ioInstance) {
  io = ioInstance;
}

function broadcastServiceStatus(serviceName, status) {
  if (!io) return;
  io.to('services').emit('service_status_change', {
    service: serviceName,
    status,
    timestamp: new Date().toISOString()
  });
}

function broadcastProcessChange(processInfo) {
  if (!io) return;
  io.to('processes').emit('process_change', {
    process: processInfo,
    timestamp: new Date().toISOString()
  });
}

function broadcastFileOperation(operation, result) {
  if (!io) return;
  io.to('file_operations').emit('file_operation_result', {
    operation,
    result,
    timestamp: new Date().toISOString()
  });
}

function broadcastSystemLog(logType, logEntry) {
  if (!io) return;
  io.to(`logs_${logType}`).emit('log_entry', {
    type: logType,
    entry: logEntry,
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  setIO,
  broadcastServiceStatus,
  broadcastProcessChange,
  broadcastFileOperation,
  broadcastSystemLog
};
