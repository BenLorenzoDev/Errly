// ============================================================================
// Errly — Client-Side Error Capture SDK
// Self-contained JavaScript string constant. No build step required.
// Captures: window.onerror, unhandledrejection, console.error (opt-in).
// Rate limited (10/min), session dedup, never throws.
// ============================================================================

export const ERRLY_SDK_JS = `(function() {
  'use strict';
  try {
    var script = document.currentScript;
    if (!script) return;

    var token = script.getAttribute('data-token');
    var service = script.getAttribute('data-service') || 'unknown';
    var captureConsole = script.getAttribute('data-console') === 'true';
    var endpoint = script.src.replace(/\\/sdk\\/errly\\.js.*$/, '/api/errors');

    if (!token) return;

    var MAX_ERRORS_PER_MINUTE = 10;
    var errorCount = 0;
    var sentMessages = {};
    var resetInterval = null;

    function resetCounter() {
      errorCount = 0;
    }
    resetInterval = setInterval(resetCounter, 60000);

    function isDuplicate(msg) {
      if (sentMessages[msg]) return true;
      sentMessages[msg] = true;
      return false;
    }

    function sendError(message, stack, metadata) {
      try {
        if (errorCount >= MAX_ERRORS_PER_MINUTE) return;
        if (!message) return;

        var key = message + (stack || '');
        if (isDuplicate(key)) return;

        errorCount++;

        var payload = {
          service: service,
          message: message,
          severity: 'error',
          metadata: {
            context: 'browser',
            url: window.location.href,
            userAgent: navigator.userAgent
          }
        };

        if (stack) payload.stackTrace = stack;
        if (metadata) {
          for (var k in metadata) {
            if (metadata.hasOwnProperty(k)) {
              payload.metadata[k] = metadata[k];
            }
          }
        }

        var xhr = new XMLHttpRequest();
        xhr.open('POST', endpoint, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('X-Errly-Token', token);
        xhr.send(JSON.stringify(payload));
      } catch (e) {
        // Never throw from the SDK
      }
    }

    // --- window.onerror ---
    var origOnError = window.onerror;
    window.onerror = function(message, source, lineno, colno, error) {
      try {
        var msg = String(message);
        var stack = '';
        if (error && error.stack) {
          stack = error.stack;
        } else if (source) {
          stack = msg + '\\n    at ' + source + ':' + lineno + ':' + colno;
        }
        sendError(msg, stack, {
          source: source || null,
          line: lineno || null,
          column: colno || null
        });
      } catch (e) {
        // Never throw
      }
      if (typeof origOnError === 'function') {
        return origOnError.apply(this, arguments);
      }
      return false;
    };

    // --- unhandledrejection ---
    window.addEventListener('unhandledrejection', function(event) {
      try {
        var reason = event.reason;
        var message = 'Unhandled Promise Rejection';
        var stack = '';
        if (reason instanceof Error) {
          message = reason.message || message;
          stack = reason.stack || '';
        } else if (typeof reason === 'string') {
          message = reason;
        } else if (reason) {
          message = JSON.stringify(reason);
        }
        sendError(message, stack, { type: 'unhandledrejection' });
      } catch (e) {
        // Never throw
      }
    });

    // --- console.error interception (opt-in) ---
    if (captureConsole && window.console && typeof console.error === 'function') {
      var origConsoleError = console.error;
      console.error = function() {
        try {
          var args = Array.prototype.slice.call(arguments);
          var message = args.map(function(a) {
            if (a instanceof Error) return a.message;
            if (typeof a === 'object') {
              try { return JSON.stringify(a); } catch (e) { return String(a); }
            }
            return String(a);
          }).join(' ');

          var stack = '';
          for (var i = 0; i < args.length; i++) {
            if (args[i] instanceof Error && args[i].stack) {
              stack = args[i].stack;
              break;
            }
          }

          sendError(message, stack, { type: 'console.error' });
        } catch (e) {
          // Never throw
        }
        return origConsoleError.apply(console, arguments);
      };
    }

  } catch (e) {
    // SDK initialization must never throw
  }
})();`;
