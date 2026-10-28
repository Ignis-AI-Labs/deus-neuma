Security
- Stricter installs and server setups. The Fedora package now sets up Chromium's sandbox helper like the Debian one, the server service runs with tighter limits, the setup file holding your keys is made private at startup if others could read it, and the Docker setup keeps the app on your own machine and keeps key files out of the image.
