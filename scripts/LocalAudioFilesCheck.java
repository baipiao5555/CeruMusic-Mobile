package com.ceru.music.mobile;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
public class LocalAudioFilesCheck {
    public static void main(String[] args) throws Exception {
        Path root = Path.of(args[0]).toAbsolutePath();
        Files.createDirectories(root.resolve("external"));
        Files.createDirectories(root.resolve("internal"));
        Files.write(root.resolve("external/short.WAV"), new byte[]{1});
        Files.write(root.resolve("external/incomplete.mp3.part"), new byte[]{1});
        Files.write(root.resolve("external/empty.flac"), new byte[0]);
        Files.write(root.resolve("internal/下载.flac"), new byte[]{1, 2});
        File external = root.resolve("external").toFile(), internal = root.resolve("internal").toFile();
        if (LocalAudioFiles.list(external, internal, external).size() != 2)
            throw new AssertionError("App-owned folders, short audio, deduplication and partial-file exclusion");
        if (!LocalAudioFiles.list(root.resolve("missing").toFile()).isEmpty())
            throw new AssertionError("Missing folders must not fail scans");
        System.out.println("PASS real JVM app-directory enumeration: external/internal, short uppercase audio, zero/partial exclusion, duplicate roots, missing folder");
    }
}
