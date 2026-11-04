/**
 * Native filesystem transfer hands. Both paths cross the package's allowed-root
 * wall before anything changes. impure (real filesystem).
 */
import fs from 'fs/promises';
import { validatePath } from '@modelcontextprotocol/server-filesystem/dist/lib.js';
import { getNativeFilesystemRoots } from './native-fs-roots.js';
import { secretLinkReason } from './sandbox-path-policy.js';

const said = (text) => ({ content: [{ type: 'text', text }], structuredContent: { content: text } });

const copyPath = async (source, destination, filter) => {
  await fs.cp(source, destination, { recursive: true, errorOnExist: true, force: false, filter });
};

const completeMoveCopy = (source) => {
  const reason = secretLinkReason(source);
  if (reason) throw new Error(`${reason}. The move was refused and its source remains in place.`);
  return true;
};

export const copyFile = async (args) => {
  const validSource = await validatePath(args.source, getNativeFilesystemRoots());
  const validDest = await validatePath(args.destination, getNativeFilesystemRoots());
  await copyPath(validSource, validDest, (source) => !secretLinkReason(source));
  return said(`Successfully copied ${args.source} to ${args.destination}`);
};

export const moveFile = async (args) => {
  const validSource = await validatePath(args.source, getNativeFilesystemRoots());
  const validDest = await validatePath(args.destination, getNativeFilesystemRoots());
  try {
    await fs.rename(validSource, validDest);
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
    await copyPath(validSource, validDest, completeMoveCopy);
    try {
      await fs.rm(validSource, { recursive: true, force: false });
    } catch (removeError) {
      throw new Error(
        `Copied ${args.source} to ${args.destination}, but could not remove the source: ${removeError.message}. Both paths remain; no data was lost.`,
        { cause: removeError },
      );
    }
  }
  return said(`Successfully moved ${args.source} to ${args.destination}`);
};
