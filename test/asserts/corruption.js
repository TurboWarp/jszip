"use strict";

QUnit.module("corruption", function () {
    JSZipTestUtils.testZipFile("load(string) works", "ref/no-central-directory/truncated.zip", function(assert, file) {
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
});
