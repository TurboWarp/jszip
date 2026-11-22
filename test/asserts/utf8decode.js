"use strict";

// UTF-8 is decoded with TextDecoder, in one go or as a stream.
QUnit.module("utf8 decode", function () {
    var NAME = "data.txt";
    var external = JSZip.external;

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

    // [name, bytes, result]
    var UTF8_CASES = [
        ["byte order mark", [0xef, 0xbb, 0xbf, 0x61], "\ufeffa"],
        ["lead byte without continuation", [0x61, 0xc3, 0x41, 0x62], "a\ufffdAb"],
        ["lone continuation byte", [0x61, 0x80, 0x62], "a\ufffdb"],
        ["0xff", [0x61, 0xff, 0x62, 0x62, 0x62, 0x62, 0x62, 0x63], "a\ufffdbbbbbc"],
        ["overlong encoding", [0x61, 0xc0, 0x80, 0x62], "a\ufffd\ufffdb"],
        ["encoded surrogate", [0x61, 0xed, 0xa0, 0x80, 0x62], "a\ufffd\ufffd\ufffdb"],
        ["above U+10FFFF", [0x61, 0xf4, 0x90, 0x80, 0x80, 0x62], "a\ufffd\ufffd\ufffd\ufffdb"],
        ["valid multi-byte characters", [0x61, 0xc3, 0xa9, 0xe4, 0xb8, 0xad, 0xf0, 0x9f, 0x92, 0xa9], "a\u00e9\u4e2d\ud83d\udca9"]
    ];
    UTF8_CASES.forEach(function (testCase) {
        var bytes = new Uint8Array(testCase[1]);
        var expected = testCase[2];

        QUnit.test("text with " + testCase[0] + " in a small entry", function (assert) {
            var done = assert.async();
            new JSZip().file(NAME, bytes).generateAsync({type: "uint8array", compression: "DEFLATE"}).then(JSZip.loadAsync).then(function (zip) {
                return zip.file(NAME).async("string");
            }).then(function (text) {
                assert.equal(text, expected);
                done();
            })["catch"](JSZipTestUtils.assertNoError);
        });

        QUnit.test("text with " + testCase[0] + " in a large entry", function (assert) {
            var done = assert.async();
            // Away from 64 KiB chunk boundaries.
            var prefix = makeText(200 * 1024).replace(/[^ -~]/g, "x");
            prefix = prefix.slice(0, prefix.length - prefix.length % 65536 + 30000);
            var suffix = makeText(100 * 1024).replace(/[^ -~]/g, "y");
            var data = new Uint8Array(prefix.length + bytes.length + suffix.length);
            var i;
            for (i = 0; i < prefix.length; i++) {
                data[i] = prefix.charCodeAt(i);
            }
            data.set(bytes, prefix.length);
            for (i = 0; i < suffix.length; i++) {
                data[prefix.length + bytes.length + i] = suffix.charCodeAt(i);
            }
            new JSZip().file(NAME, data).generateAsync({type: "uint8array", compression: "DEFLATE"}).then(JSZip.loadAsync).then(function (zip) {
                return external.Promise.all([
                    zip.file(NAME).async("string"),
                    zip.file(NAME).async("text"),
                    // onUpdate goes through Utf8DecodeWorker.
                    zip.file(NAME).async("string", function () {})
                ]);
            }).then(function (texts) {
                assert.ok(texts[0] === prefix + expected + suffix, "string");
                assert.ok(texts[1] === prefix + expected + suffix, "text");
                assert.ok(texts[2] === prefix + expected + suffix, "stream");
                done();
            })["catch"](JSZipTestUtils.assertNoError);
        });
    });

    QUnit.test("zip in shared memory", function (assert) {
        if (typeof SharedArrayBuffer === "undefined") {
            assert.ok(true, "no SharedArrayBuffer");
            return;
        }
        var done = assert.async();
        var name = "é/" + NAME;
        var text = makeText(200 * 1024);
        new JSZip().file(name, text).generateAsync({type: "uint8array", compression: "DEFLATE"}).then(function (zip) {
            var shared = new Uint8Array(new SharedArrayBuffer(zip.length));
            shared.set(zip);
            return JSZip.loadAsync(shared);
        }).then(function (zip) {
            return external.Promise.all([
                zip.file(name).async("string"),
                zip.file(name).async("string", function () {})
            ]);
        }).then(function (texts) {
            assert.ok(texts[0] === text, "string");
            assert.ok(texts[1] === text, "stream");
            done();
        })["catch"](JSZipTestUtils.assertNoError);
    });

    QUnit.test("character split across chunks", function (assert) {
        var done = assert.async();
        // U+1F4A9 starts 2 bytes before the 64 KiB chunk boundary.
        var data = new Uint8Array(65536 + 2);
        data.fill(0x61);
        data.set([0xf0, 0x9f, 0x92, 0xa9], 65534);
        var expected = new Array(65535).join("a") + "\ud83d\udca9";
        new JSZip().file(NAME, data).generateAsync({type: "uint8array", compression: "DEFLATE"}).then(JSZip.loadAsync).then(function (zip) {
            return external.Promise.all([
                zip.file(NAME).async("string"),
                zip.file(NAME).async("string", function () {})
            ]);
        }).then(function (texts) {
            assert.ok(texts[0] === expected, "string");
            assert.ok(texts[1] === expected, "stream");
            done();
        })["catch"](JSZipTestUtils.assertNoError);
    });
});
