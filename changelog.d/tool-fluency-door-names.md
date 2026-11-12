Fixed
- A model that calls a tool through the general "call" tool using the tool's function-list spelling (like caller__get_weather) now reaches that tool on the first try. Before, the call was answered "unavailable" and the model had to try again: 238 wasted steps in benchmark runs from Oct 25 to Nov 8.
- When the coding shell can't start, checking its status now gives the real reason (for example, the folder doesn't exist) instead of an internal error message.
