"use strict";

QUnit.module("corruption", function () {
    JSZipTestUtils.testZipFile("recovers zip without central directory", "ref/no-central-directory/truncated.zip", function(assert, file) {
        var done = assert.async();
        JSZip.loadAsync(file, {
            recoverCorrupted: true
        })
            .then(function (zip) {
                return zip.file("project.json").async("string");
            })
            .then(function(result) {
                const parsed = JSON.parse(result);
                assert.equal(parsed.targets[0].name, "Stage");
                done();
            })
            .catch(JSZipTestUtils.assertNoError);
    });

    JSZipTestUtils.testZipFile("calls onCorruptCentralDirectory and onUnrecoverableFileEntry", "ref/no-central-directory/more-truncated.zip", function(assert, file) {
        var done = assert.async();
        var centralDirectoryErrors = [];
        var fileEntryErrors = [];
        JSZip.loadAsync(file, {
            recoverCorrupted: true,
            onCorruptCentralDirectory: (error) => {
                centralDirectoryErrors.push(error.message);
            },
            onUnrecoverableFileEntry: (error) => {
                fileEntryErrors.push(error.message);
            }
        })
            .then(function () {
                assert.deepEqual(centralDirectoryErrors, [
                    "Corrupted zip: can't find end of central directory"
                ]);
                assert.deepEqual(fileEntryErrors, [
                    "End of data reached (data length = 1000, asked index = 2194). Corrupted zip ?"
                ]);
                done();
            })
            .catch(JSZipTestUtils.assertNoError);
    });
});
