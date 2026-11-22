"use strict";

// Results with DecompressionStream must match results without it (pako).
QUnit.module("native inflate", function () {
    var NAME = "data.txt";

    // Compresses poorly. Mostly ASCII, with some multi-byte characters.
    function makeText(length) {
        var parts = [];
        var seed = 1;
        var total = 0;
        while (total < length) {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            var word = seed.toString(36);
            if (seed % 97 === 0) {
                word += "\u00e9\u4e2d\ud83d\udca9";
            }
            parts.push(word);
            total += word.length + 1;
        }
        return parts.join(" ");
    }
    var TEXT = makeText(300 * 1024);

    function bytesOf(text) {
        return new JSZip().file(NAME, text).file(NAME).async("uint8array");
    }

    function readInt(bytes, offset, size) {
        var result = 0;
        for (var i = size - 1; i >= 0; i--) {
            result = result * 256 + bytes[offset + i];
        }
        return result;
    }
    function writeInt(bytes, offset, size, value) {
        for (var i = 0; i < size; i++) {
            bytes[offset + i] = value & 0xff;
            value = value >>> 8;
        }
    }
    function findCentralHeader(zip) {
        for (var i = zip.length - 22; i >= 0; i--) {
            if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x01 && zip[i + 3] === 0x02) {
                return i;
            }
        }
        throw new Error("no central directory header");
    }

    /**
     * @param {String} text the text to compress.
     * @return {Promise<Uint8Array>} the raw DEFLATE data JSZip makes for it.
     */
    function deflate(text) {
        return new JSZip().file(NAME, text).generateAsync({type: "uint8array", compression: "DEFLATE"}).then(function (zip) {
            var compressedSize = readInt(zip, 18, 4);
            var start = 30 + readInt(zip, 26, 2) + readInt(zip, 28, 2);
            return zip.subarray(start, start + compressedSize);
        });
    }

    /**
     * Make a zip with one DEFLATE entry, even if the data or size are wrong.
     * @param {Uint8Array} compressed the compressed data.
     * @param {number} uncompressedSize the size to write in the headers.
     * @return {Promise<Uint8Array>} the zip.
     */
    function zipWithEntry(compressed, uncompressedSize) {
        // Store the bytes as they are, then mark the entry as DEFLATE.
        return new JSZip().file(NAME, compressed).generateAsync({type: "uint8array", compression: "STORE"}).then(function (zip) {
            var central = findCentralHeader(zip);
            writeInt(zip, 8, 2, 8);
            writeInt(zip, 22, 4, uncompressedSize);
            writeInt(zip, central + 10, 2, 8);
            writeInt(zip, central + 24, 4, uncompressedSize);
            return zip;
        });
    }

    function settle(promise) {
        return promise.then(function (value) {
            return {value: value};
        }, function (error) {
            return {error: String(error && error.message || error)};
        });
    }

    function toArray(value) {
        if (value === null || value === undefined) {
            return value;
        }
        if (typeof Blob !== "undefined" && value instanceof Blob) {
            return ["Blob", value.size, value.type];
        }
        if (value instanceof ArrayBuffer) {
            value = new Uint8Array(value);
        }
        return typeof value === "string" ? value : Array.prototype.slice.call(value);
    }

    var root = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : global;

    /**
     * @param {Function} read starts a read and returns its promise.
     * @return {Promise} the read, done without DecompressionStream.
     */
    function withoutNative(read) {
        var saved = root.DecompressionStream;
        var restore = function () {
            root.DecompressionStream = saved;
        };
        root.DecompressionStream = undefined;
        var promise;
        try {
            promise = read();
        } catch (e) {
            restore();
            throw e;
        }
        return promise.then(function (value) {
            restore();
            return value;
        }, function (error) {
            restore();
            throw error;
        });
    }

    /**
     * Check each type reads the same with and without DecompressionStream.
     * @param {Uint8Array|String} zipData the zip.
     */
    function checkSameAsPako(assert, zipData, types) {
        var done = assert.async();
        var copy = zipData instanceof Uint8Array ? new Uint8Array(zipData) : zipData;
        JSZip.loadAsync(zipData).then(function (zip) {
            var file = zip.file(NAME);
            return types.reduce(function (previous, type) {
                var actual;
                return previous.then(function () {
                    return settle(file.async(type));
                }).then(function (result) {
                    actual = result;
                    return settle(withoutNative(function () {
                        return file.async(type);
                    }));
                }).then(function (expected) {
                    if (expected.error) {
                        assert.equal(actual.error, expected.error, type + ": same error");
                    } else if (actual.error) {
                        assert.ok(false, type + ": unexpected error " + actual.error);
                    } else if (actual.value === null || actual.value === undefined) {
                        assert.ok(false, type + ": no content");
                    } else {
                        assert.deepEqual(toArray(actual.value), toArray(expected.value), type + ": same content");
                    }
                });
            }, external.Promise.resolve());
        }).then(function () {
            if (zipData instanceof Uint8Array) {
                assert.deepEqual(Array.prototype.slice.call(zipData), Array.prototype.slice.call(copy), "the loaded data is not modified");
            }
            done();
        })["catch"](JSZipTestUtils.assertNoError);
    }

    var external = JSZip.external;
    var BINARY_TYPES = ["uint8array", "arraybuffer", "array", "binarystring", "base64"];
    var ALL_TYPES = BINARY_TYPES.concat(["string", "text"]);
    // Including unsupported types.
    ALL_TYPES.push("nodebuffer", "blob", "Uint8Array", "not a type");

    QUnit.test("a large entry reads the same in every output type", function (assert) {
        var done = assert.async();
        new JSZip().file(NAME, TEXT).generateAsync({type: "uint8array", compression: "DEFLATE"}).then(function (zip) {
            checkSameAsPako(assert, zip, ALL_TYPES);
            return JSZip.loadAsync(zip);
        }).then(function (zip) {
            return external.Promise.all([zip.file(NAME).async("string"), zip.file(NAME).async("uint8array"), bytesOf(TEXT)]);
        }).then(function (results) {
            assert.equal(results[0], TEXT, "string");
            assert.deepEqual(Array.prototype.slice.call(results[1]), Array.prototype.slice.call(results[2]), "uint8array");
            done();
        })["catch"](JSZipTestUtils.assertNoError);
    });

    QUnit.test("an entry of a zip loaded from a binary string reads the same", function (assert) {
        var done = assert.async();
        new JSZip().file(NAME, TEXT).generateAsync({type: "binarystring", compression: "DEFLATE"}).then(function (zip) {
            checkSameAsPako(assert, zip, ["uint8array", "string"]);
            return JSZip.loadAsync(zip);
        }).then(function (zip) {
            return zip.file(NAME).async("string");
        }).then(function (text) {
            assert.equal(text, TEXT);
            done();
        })["catch"](JSZipTestUtils.assertNoError);
    });

    QUnit.test("onUpdate is called while reading", function (assert) {
        var done = assert.async();
        new JSZip().file(NAME, TEXT).generateAsync({type: "uint8array", compression: "DEFLATE"}).then(JSZip.loadAsync).then(function (zip) {
            var updates = [];
            return zip.file(NAME).async("string", function (meta) {
                updates.push(meta.percent);
            }).then(function (text) {
                assert.equal(text, TEXT, "content");
                assert.ok(updates.length > 1, "several updates");
                assert.equal(updates[updates.length - 1], 100, "last update is 100%");
                done();
            });
        })["catch"](JSZipTestUtils.assertNoError);
    });

    QUnit.test("an ArrayBuffer result is exactly as long as the entry", function (assert) {
        var done = assert.async();
        var zip = new JSZip();
        var sizes = [1, 100, 5000, 20000, 70000, 300000];
        sizes.forEach(function (size) {
            zip.file(size + ".txt", makeText(size).replace(/[^ -~]/g, "x").slice(0, size));
        });
        zip.generateAsync({type: "uint8array", compression: "DEFLATE"}).then(JSZip.loadAsync).then(function (loaded) {
            return external.Promise.all(sizes.map(function (size) {
                return loaded.file(size + ".txt").async("arraybuffer");
            }));
        }).then(function (buffers) {
            buffers.forEach(function (buffer, i) {
                assert.ok(buffer instanceof ArrayBuffer, sizes[i] + ": ArrayBuffer");
                assert.equal(buffer.byteLength, sizes[i], sizes[i] + ": length");
            });
            done();
        })["catch"](JSZipTestUtils.assertNoError);
    });

    QUnit.test("a large entry reads the same when many are read at once", function (assert) {
        var done = assert.async();
        var zip = new JSZip();
        for (var i = 0; i < 20; i++) {
            zip.file(i + ".txt", makeText(20 * 1024 + i * 4000) + i);
        }
        zip.generateAsync({type: "uint8array", compression: "DEFLATE"}).then(JSZip.loadAsync).then(function (loaded) {
            var reads = [];
            for (var i = 0; i < 20; i++) {
                reads.push(loaded.file(i + ".txt").async("string"));
            }
            return external.Promise.all(reads);
        }).then(function (texts) {
            for (var i = 0; i < 20; i++) {
                assert.equal(texts[i], makeText(20 * 1024 + i * 4000) + i, i + ".txt");
            }
            done();
        })["catch"](JSZipTestUtils.assertNoError);
    });

    function testBrokenEntry(name, makeEntry) {
        QUnit.test(name, function (assert) {
            var done = assert.async();
            external.Promise.all([deflate(TEXT), bytesOf(TEXT)]).then(function (results) {
                return makeEntry(results[0], results[1].length);
            }).then(function (zip) {
                checkSameAsPako(assert, zip, ["uint8array", "string"]);
                done();
            })["catch"](JSZipTestUtils.assertNoError);
        });
    }

    testBrokenEntry("bytes after the end of the compressed data", function (compressed, size) {
        var data = new Uint8Array(compressed.length + 100);
        data.set(compressed);
        for (var i = compressed.length; i < data.length; i++) {
            data[i] = i & 0xff;
        }
        return zipWithEntry(data, size);
    });

    testBrokenEntry("zeros after the end of the compressed data", function (compressed, size) {
        var data = new Uint8Array(compressed.length + 100);
        data.set(compressed);
        return zipWithEntry(data, size);
    });

    testBrokenEntry("truncated compressed data", function (compressed, size) {
        return zipWithEntry(compressed.subarray(0, compressed.length >> 1), size);
    });

    testBrokenEntry("compressed data missing its last byte", function (compressed, size) {
        return zipWithEntry(compressed.subarray(0, compressed.length - 1), size);
    });

    testBrokenEntry("uncompressed size too small", function (compressed, size) {
        return zipWithEntry(compressed, size - 1);
    });

    testBrokenEntry("uncompressed size too big", function (compressed, size) {
        return zipWithEntry(compressed, size + 1);
    });

    testBrokenEntry("uncompressed size impossibly big", function (compressed) {
        return zipWithEntry(compressed, 0xfffffff0);
    });

    testBrokenEntry("uncompressed size zero", function (compressed) {
        return zipWithEntry(compressed, 0);
    });

    testBrokenEntry("garbage instead of compressed data", function (compressed, size) {
        var data = new Uint8Array(compressed.length);
        for (var i = 0; i < data.length; i++) {
            data[i] = (i * 7919) & 0xff;
        }
        return zipWithEntry(data, size);
    });

    [0.001, 0.25, 0.5, 0.75, 0.999].forEach(function (where) {
        testBrokenEntry("flipped bits at " + where * 100 + "% of the compressed data", function (compressed, size) {
            var data = new Uint8Array(compressed);
            var index = Math.floor(data.length * where);
            data[index] ^= 0x5a;
            data[index + 1] ^= 0x81;
            return zipWithEntry(data, size);
        });
    });
});
