// Throwaway diagnostic, not part of the harness. Goes with test/probes/.
//
// The candidate fix for the macos-15-intel ActionLog failure, as a mocha
// --require so it can be switched on and off from the workflow and the two
// arms compared on the same runner.
//
// Every axios request poisons the keep-alive socket it used. The node adapter
// calls req.setTimeout on both of its branches -- with the configured timeout
// if there is one, and req.setTimeout(0) if there is not, "to explicitly reset
// the socket timeout value for a possible keep-alive request". That reaches
// follow-redirects, whose setTimeout does
//
//     socket.addListener("timeout", socket.destroy)
//
// and whose clearTimer() removes its listeners from the request and never that
// one from the socket. The socket returns to http.globalAgent's free pool still
// carrying a listener that destroys it the next time a 'timeout' is emitted --
// and since node 19 the global agent arms one, five seconds by default. Node's
// own handler for that event destroys the socket only if it is in the free
// list; the leaked one destroys it whatever it is doing. So a request that is
// simply slow to answer dies mid-flight, with no error and nothing from the
// peer, which is exactly what the trace on macos-15-intel showed.
//
// Nothing here is mac-specific. It is masked wherever the server answers within
// the five seconds, and mac-intel is the only runner whose first pyodide call
// routinely does not.
//
// Disabling the agent's idle timer leaves the leaked listener in place but
// never arms it. follow-redirects 1.16.0 is the current release and still has
// the leak, so there is nothing to upgrade to.

const http = require('http');
const https = require('https');

const before = http.globalAgent.options.timeout;
http.globalAgent.options.timeout = 0;
https.globalAgent.options.timeout = 0;
console.log(`[agent idle timer: ${before}ms -> ${http.globalAgent.options.timeout}ms]`);
