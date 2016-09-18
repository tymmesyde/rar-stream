//@flow
import RarFileBundle from '../rar-file/rar-file-bundle';
import RarFile from '../rar-file/rar-file';
import RarFileChunk from '../rar-file/rar-file-chunk';
import FileMedia from '../file-media/file-media';
import MarkerHeaderParser from '../parsing/marker-header-parser';
import AchiverHeadParser from '../parsing/archive-header-parser';
import FileHeaderParser from '../parsing/file-header-parser';
import TerminalHeaderParser from '../parsing/terminator-header-parser';

type ParseChunk = {
  name: string,
  offset: number,
  chunk: RarFileChunk
}

type Header = {
  offset: number,
  header: Object
}

export default class RarManifest {
  _rarFileBundle: RarFileBundle;
  _rarFiles: RarFile[];
  constructor(rarFileBundle: RarFileBundle){
    this._rarFileBundle = rarFileBundle;

  }
  _parseMarkerHead(fileMedia: FileMedia) : Promise<Header>{
    return fileMedia.createReadStream(0, MarkerHeaderParser.bytesToRead)
                    .then(stream => new MarkerHeaderParser(stream))
                    .then(parser => parser.parse())
                    .then(header => ({offset: header.size, header}));
  }
  _parseArchiveHead(offset: number, fileMedia: FileMedia) :  Promise<Header>{
    return fileMedia.createReadStream(offset, AchiverHeadParser.bytesToRead)
                    .then(stream => new AchiverHeadParser(stream))
                    .then(parser => parser.parse())
                    .then(header => ({offset: offset + header.size, header}));
  }
  _combineIntoFiles (fileChunks: ParseChunk[]) : RarFile[] {
    const groupedChunks = fileChunks.reduce((rarFileChunks, chunks) => {
      chunks.forEach(fileChunk => {
        if(!rarFileChunks[fileChunk.name]) {
          rarFileChunks[fileChunk.name] = [];
        }
        rarFileChunks[fileChunk.name].push(fileChunk.chunk);
      });
      return rarFileChunks;
    }, {});

    return Object.keys(groupedChunks)
                 .map(fileName => new RarFile(fileName, ...groupedChunks[fileName]));
  }
  _parseFileHeads(offset: number, fileMedia: FileMedia)  :  Promise<RarFile[]>{
    const parseFile = (files = []) => {
      return fileMedia.createReadStream(offset, offset + FileHeaderParser.bytesToRead)
                    .then(stream => new FileHeaderParser(stream))
                    .then(parser => parser.parse())
                    .then(fileHeader => ([...files, {
                      name: fileHeader.name,
                      continuesInNext: fileHeader.continuesInNext,
                      offset: offset + fileHeader.headSize + fileHeader.size,
                      chunk: new RarFileChunk(
                        fileMedia,
                        offset += fileHeader.headSize,
                        offset += fileHeader.size)
                    }]));
                  };

    const parseFiles = (parseFilePromise = Promise.resolve([])) : Promise<ParseChunk[]> => {
      parseFilePromise = parseFilePromise.then(files => {
                        const mediaEnd = fileMedia.size - 20;
                        const previous = files[files.length -1];
                        return (!previous || (!previous.continuesInNext && previous.offset < mediaEnd))
                          ? parseFiles(parseFile(files))
                          : files;
                       });
      return parseFilePromise;
    };
    return parseFiles();
  }
  _parse() :  Promise<RarFile[]>{
    const parseFileMedia = (fileMedia) => this._parseMarkerHead(fileMedia)
                      .then(({offset}) => this._parseArchiveHead(offset, fileMedia))
                      .then(({offset}) => this._parseFileHeads(offset, fileMedia));

    return Promise.all(this._rarFileBundle.files.map(parseFileMedia))
                  .then(fileChunks => this._combineIntoFiles(fileChunks));
  }
  getFiles() : Promise<RarFile[]>{
    return this._parse();
  }
}
