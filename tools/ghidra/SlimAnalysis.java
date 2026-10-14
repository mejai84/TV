// SlimAnalysis.java  --  GhidraScript headless (preScript)
// Fase 10: recorta los analizadores caros para caber en 8 GB de RAM.

import ghidra.app.script.GhidraScript;

public class SlimAnalysis extends GhidraScript {

    private static final String[] OFF = {
        "Decompiler Parameter ID",
        "Decompiler Switch Analysis",
        "Decompiler CFG Correction",
        "Decompiler CFG Recovery",
        "Function ID",
        "Non-Returning Functions - Discovered",
        "Non-Returning Functions - Discovered - Aggressive",
        "Dynamic Symbol Search",
        "DWARF",
        "Embedded Media",
        "Pcode Attributes",
        "x86-64 Constant Analyzer",
        "Aggressive x86-64 Constant Analyzer",
        "Windows x86 Constant Analyzer",
        "Stack Pointer Create",
        "ASCII Strings",
        "Comment Outliers",
        "Subroutine View",
        "Decompile C++ Annotations",
    };

    @Override
    public void run() throws Exception {
        println("SlimAnalysis: recortando analizadores de " + currentProgram.getName());
        int n = 0;
        for (String k : OFF) {
            try {
                setAnalysisOption(currentProgram, k, "false");
                n++;
            } catch (Exception e) {
                // la clave puede no existir en esta version
            }
        }
        println("SlimAnalysis: " + n + " analizadores desactivados");
        println("SLIM_ANALYSIS_OK");
    }
}