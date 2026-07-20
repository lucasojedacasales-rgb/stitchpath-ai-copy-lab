import { buildDSTFromCommands } from './dstDirectExport';
import { encodeCanonicalCommandsToFile } from './exportPipeline';
import { parseDST, parseDSB } from './exportedFileBinaryRoundtripForensics';

export async function runMinimalBinaryExportTest({ base44Client, machineSettings }) {
  const commands = buildMinimalCommands();
  const dstBuilt = buildDSTFromCommands(commands, { label: 'MINIMAL_TEST', ce01Strict: true });
  const dstBytes = dstBuilt.bytes || new Uint8Array(await dstBuilt.blob.arrayBuffer());
  const dstParse = parseDST(dstBytes);

  let dsbBlob = null;
  let dsbBytes = new Uint8Array();
  let dsbParse = parseDSB(dsbBytes);
  let dsbError = null;
  try {
    const dsb = await encodeCanonicalCommandsToFile({
      commands,
      objects: [],
      format: 'DSB',
      machineSettings,
      base44Client,
    });
    dsbBlob = dsb.blob;
    dsbBytes = new Uint8Array(await dsbBlob.arrayBuffer());
    dsbParse = parseDSB(dsbBytes);
  } catch (error) {
    dsbError = error.message || String(error);
  }

  return {
    commands,
    dst: {
      blob: dstBuilt.blob,
      bytes: dstBytes,
      blobSizeBytes: dstBuilt.blob.size || dstBytes.length,
      parseable: dstParse.binaryFileValid,
      endPresent: dstParse.endPresent,
      parseErrors: dstParse.parseErrors,
    },
    dsb: {
      blob: dsbBlob,
      bytes: dsbBytes,
      blobSizeBytes: dsbBlob?.size || dsbBytes.length,
      parseable: dsbParse.binaryFileValid,
      endPresent: dsbParse.endPresent,
      parseErrors: dsbParse.parseErrors,
      error: dsbError,
    },
  };
}

function buildMinimalCommands() {
  const commands = [];
  for (let i = 0; i < 10; i++) {
    commands.push({ type: 'stitch', x: i, y: 0, color: '#000000' });
  }
  commands.push({ type: 'end', x: 9, y: 0, color: null });
  return commands;
}