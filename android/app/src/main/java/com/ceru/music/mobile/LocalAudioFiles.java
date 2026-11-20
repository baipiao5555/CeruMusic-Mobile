package com.ceru.music.mobile;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;

/** App-owned Music folders are not indexed by MediaStore on scoped-storage Android. */
final class LocalAudioFiles {
    static List<File> list(File... directories) {
        LinkedHashMap<String, File> files = new LinkedHashMap<>();
        for (File directory : directories) {
            if (directory == null) continue;
            try {
                String root = directory.getCanonicalPath() + File.separator;
                File[] children = directory.listFiles();
                if (children == null) continue;
                for (File file : children) {
                    String name = file.getName().toLowerCase(Locale.ROOT);
                    if (!file.isFile() || file.length() <= 0 || !file.canRead()
                            || !name.matches(".*\\.(mp3|flac|m4a|aac|ogg|opus|wav|wma|aiff|aif)")) continue;
                    String canonical = file.getCanonicalPath();
                    if (canonical.startsWith(root)) files.put(canonical, file);
                }
            } catch (Exception ignored) { /* A missing folder must not prevent scanning the other one. */ }
        }
        List<File> result = new ArrayList<>(files.values());
        Collections.sort(result, (a, b) -> a.getName().compareToIgnoreCase(b.getName()));
        return result;
    }
}
