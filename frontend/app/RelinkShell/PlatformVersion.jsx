import { version as platformVersion } from '../../../package.json';
import './PlatformVersion.css';

/**
 * Render the build-time NEUMA package version in the desk frame.
 * @returns {import('react').ReactElement}
 */
export const PlatformVersion = () => (
  <span
    className="platform-version label-data"
    aria-label={`NEUMA platform version ${platformVersion}`}
  >
    NEUMA // {platformVersion}
  </span>
);
