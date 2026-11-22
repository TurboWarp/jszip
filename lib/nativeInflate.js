"use strict";
/* global DecompressionStream */

var external = require("./external");
var utils = require("./utils");

var ignore = function () {};

/**
 * @param {Uint8Array[]} chunks the chunks.
 * @param {number} length their total length.
 * @return {Uint8Array} the chunks joined, in a buffer of exactly that length.
 */
var join = function (chunks, length) {
    if (chunks.length === 1 && chunks[0].byteOffset === 0 && chunks[0].buffer.byteLength === length) {
        return chunks[0];
    }
    var result = new Uint8Array(length);
    var offset = 0;
    for (var i = 0; i < chunks.length; i++) {
        result.set(chunks[i], offset);
        offset += chunks[i].length;
    }
    return result;
};

/**
 * Inflate raw DEFLATE data with DecompressionStream.
 * @param {String|Array|Uint8Array|Buffer} compressed the data.
 * @param {number} uncompressedSize the expected size.
 * @return {Promise<Uint8Array|null>} the data, or null on any failure or size mismatch.
 */
exports.inflate = function (compressed, uncompressedSize) {
    return new external.Promise(function (resolve) {
        var reader = null;
        var fail = function () {
            if (reader) {
                reader.cancel().then(ignore, ignore);
                reader = null;
            }
            resolve(null);
        };

        try {
            if (typeof DecompressionStream !== "function") {
                fail();
                return;
            }
            // Throws in browsers without "deflate-raw".
            var stream = new DecompressionStream("deflate-raw");
            var writer = stream.writable.getWriter();
            // The reader reports these errors too.
            writer.write(utils.unsharedUint8Array(compressed)).then(ignore, ignore);
            writer.close().then(ignore, ignore);
            reader = stream.readable.getReader();

            var chunks = [];
            var length = 0;
            var onRead = function (step) {
                if (!reader) {
                    return;
                }
                try {
                    if (step.done) {
                        reader = null;
                        resolve(length === uncompressedSize ? join(chunks, length) : null);
                        return;
                    }
                    var chunk = step.value;
                    // Stop early if there is too much output.
                    if (!(chunk instanceof Uint8Array) || chunk.length > uncompressedSize - length) {
                        fail();
                        return;
                    }
                    chunks.push(chunk);
                    length += chunk.length;
                    reader.read().then(onRead, fail);
                } catch (e) {
                    fail();
                }
            };
            reader.read().then(onRead, fail);
        } catch (e) {
            fail();
        }
    });
};
