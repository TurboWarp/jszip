"use strict";

// Stored entries are read without the stream machinery when possible.
QUnit.module("stored entries", function () {
    var NAME = "data.bin";
    var TEXT = "héllo 中💩";

    function makeBytes(length) {
        var bytes = new Uint8Array(length);
        var seed = 1;
        for (var i = 0; i < length; i++) {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            bytes[i] = seed >>> 16;
        }
        return bytes;
    }

    function storedZip(content) {
        return new JSZip().file(NAME, content).generateAsync({type: "uint8array", compression: "STORE"});
    }

    QUnit.test("uint8array content is right for many sizes", function (assert) {
        var done = assert.async();
        var sizes = [0, 1, 65535, 65536, 65537, 300 * 1024];
        var next = function (i) {
            if (i === sizes.length) {
                done();
                return;
            }
            var expected = makeBytes(sizes[i]);
            storedZip(expected).then(JSZip.loadAsync).then(function (zip) {
                return zip.file(NAME).async("uint8array");
            }).then(function (actual) {
                assert.ok(actual instanceof Uint8Array, "size " + sizes[i] + " is a Uint8Array");
                assert.deepEqual(Array.prototype.slice.call(actual), Array.prototype.slice.call(expected), "size " + sizes[i] + " matches");
                next(i + 1);
            })["catch"](JSZipTestUtils.assertNoError);
        };
        next(0);
    });

    QUnit.test("result does not share memory with the zip", function (assert) {
        var done = assert.async();
        var expected = makeBytes(1000);
        storedZip(expected).then(function (zipBytes) {
            return JSZip.loadAsync(zipBytes).then(function (zip) {
                return zip.file(NAME).async("uint8array").then(function (first) {
                    assert.notStrictEqual(first.buffer, zipBytes.buffer, "has its own buffer");
                    assert.equal(first.byteOffset, 0, "starts at the start of its buffer");
                    assert.equal(first.buffer.byteLength, 1000, "buffer is exactly as long as the content");
                    first[0] = first[0] ^ 0xff;
                    return zip.file(NAME).async("uint8array");
                });
            });
        }).then(function (second) {
            assert.equal(second[0], expected[0], "changing a result does not change the zip");
            done();
        })["catch"](JSZipTestUtils.assertNoError);
    });

    QUnit.test("other types match the stream", function (assert) {
        var done = assert.async();
        var types = ["string", "text", "binarystring", "base64", "array", "arraybuffer", "uint8array"];
        storedZip(TEXT).then(JSZip.loadAsync).then(function (zip) {
            var file = zip.file(NAME);
            return JSZip.external.Promise.all(types.map(function (type) {
                return JSZip.external.Promise.all([
                    file.async(type),
                    file.internalStream(type).accumulate()
                ]).then(function (results) {
                    var plain = function (value) {
                        if (value instanceof ArrayBuffer) {
                            value = new Uint8Array(value);
                        }
                        return typeof value === "string" ? value : Array.prototype.slice.call(value);
                    };
                    assert.deepEqual(plain(results[0]), plain(results[1]), type + " matches");
                });
            })).then(function () {
                return file.async("string");
            });
        }).then(function (text) {
            assert.equal(text, TEXT, "text is decoded as UTF-8");
            done();
        })["catch"](JSZipTestUtils.assertNoError);
    });

    QUnit.test("onUpdate is still called", function (assert) {
        var done = assert.async();
        var updates = 0;
        storedZip(makeBytes(200 * 1024)).then(JSZip.loadAsync).then(function (zip) {
            return zip.file(NAME).async("uint8array", function () {
                updates++;
            });
        }).then(function (content) {
            assert.equal(content.length, 200 * 1024, "content is complete");
            assert.ok(updates > 0, "onUpdate was called");
            done();
        })["catch"](JSZipTestUtils.assertNoError);
    });

    QUnit.test("wrong uncompressed size is still an error", function (assert) {
        var done = assert.async();
        storedZip(makeBytes(1000)).then(JSZip.loadAsync).then(function (zip) {
            zip.file(NAME)._data.uncompressedSize = 999;
            return zip.file(NAME).async("uint8array");
        }).then(function () {
            assert.ok(false, "should have failed");
            done();
        }, function (e) {
            assert.ok(/size mismatch/.test(e.message), "reports the size mismatch");
            done();
        });
    });
});
