"use strict";
var USE_TYPEDARRAY = (typeof Uint8Array !== "undefined") && (typeof Uint16Array !== "undefined") && (typeof Uint32Array !== "undefined");

var utils = require("./utils");
var GenericWorker = require("./stream/GenericWorker");

var ARRAY_TYPE = USE_TYPEDARRAY ? "uint8array" : "array";

exports.magic = "\x08\x00";

/* globals CompressionStream, DecompressionStream */

/**
 * @typedef {'Deflate'|'Inflate'} Action
 */

/**
 * Create a worker that uses pako to inflate/deflate.
 * @constructor
 * @param {Action} action the name of the pako function to call : either "Deflate" or "Inflate".
 * @param {Object} options the options to use when (de)compressing.
 */
function FlateWorker(action, options) {
    GenericWorker.call(this, "FlateWorker/" + action);

    this._initialized = false;
    /** @type {Action} */
    this._action = action;
    this._options = options;

    this._stream = null;
    this._streamWriter = null;
    this._pako = null;

    this._handleStreamError = this._handleStreamError.bind(this);

    // the `meta` object from the last chunk received
    // this allow this worker to pass around metadata
    this.meta = {};
}

utils.inherits(FlateWorker, GenericWorker);

/**
 * @see GenericWorker.processChunk
 */
FlateWorker.prototype.processChunk = function (chunk) {
    this.meta = chunk.meta;

    if (!this._initialized) {
        this._initialize();
    }

    console.log("Writing", chunk);

    if (this._streamWriter) {
        this._streamWriter
            .write(utils.transformTo(ARRAY_TYPE, chunk.data))
            .catch(this._handleStreamError);
    } else if (this._pako) {
        this._pako.push(utils.transformTo(ARRAY_TYPE, chunk.data), false);
    } else {
        throw new Error("processChunk() object missing");
    }
};

/**
 * @see GenericWorker.flush
 */
FlateWorker.prototype.flush = function () {
    GenericWorker.prototype.flush.call(this);

    console.log("Flushing");

    if (!this._initialized) {
        this._initialize();
    }

    if (this._streamWriter) {
        this._streamWriter
            .close()
            .catch(this._handleStreamError);
    } else if (this._pako) {
        this._pako.push([], true);
    } else {
        throw new Error("flush() object missing");
    }
};
/**
 * @see GenericWorker.cleanUp
 */
FlateWorker.prototype.cleanUp = function () {
    GenericWorker.prototype.cleanUp.call(this);
    this._pako = null;
};

/**
 * Initialize worker using the best available underlying API.
 */
FlateWorker.prototype._initialize = function () {
    try {
        this._initializeStream();
    } catch (error) {
        // Streams not supported. Fall back to pure JS implementation.
        this._initializePako();
    }

    this._initialized = true;
};

/**
 * Initialize worker using native compression or decompression stream.
 */
FlateWorker.prototype._initializeStream = function () {
    if (this._action === "Deflate") {
        this._stream = new CompressionStream("deflate-raw");
    } else if (this._action === "Inflate") {
        this._stream = new DecompressionStream("deflate-raw");
    } else {
        throw new Error(`Invalid action: ${this._action}`);
    }

    const reader = this._stream.readable.getReader();
    const writer = this._stream.writable.getWriter();
    this._streamWriter = writer;

    const handleSuccess = data => {
        if (!data.done) {
            console.log("Received", data.value);

            this.push({
                data: data.value,
                meta: this.meta
            });

            reader.read().then(handleSuccess, this._handleStreamError);
        } else {
            console.log("Received done");
        }
    };

    reader.read().then(handleSuccess, this._handleStreamError);
};

/**
 * Handle errors while using the native stream.
 */
FlateWorker.prototype._handleStreamError = function (error) {
    console.error('XXX', error);
};

/**
 * Initialize worker using JavaScript pako implementation.
 */
FlateWorker.prototype._initializePako = function () {
    var pako = require("pako");
    this._pako = new pako[this._action]({
        chunkSize: 65536,
        raw: true,
        level: this._options.level || -1 // default compression
    });
    var self = this;
    this._pako.onData = function(data) {
        console.log("Received", data);

        self.push({
            data : data,
            meta : self.meta
        });
    };
};

exports.compressWorker = function (compressionOptions) {
    return new FlateWorker("Deflate", compressionOptions);
};
exports.uncompressWorker = function () {
    return new FlateWorker("Inflate", {});
};
