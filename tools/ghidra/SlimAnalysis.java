// SlimAnalysis.java  --  GhidraScript headless (preScript)
// Fase 10: recorta los analizadores caros para caber en 8 GB de RAM.
//
// Uso: -preScript SlimAnalysis.java
// Los preScripts se ejecutan ANTES del auto-analyze, que es donde se fija
// el conjunto de analizadores activos del programa.

import ghidra.app.script.GhidraScript;
import ghidra.framework.options.Options;
import ghidra.program.model.listing.Program;

public class SlimAnalysis extends GhidraScript {

    // Analizadores desactivados: son los que mas RAM y tiempo consumen y
    // ninguno aporta nada para leer la logica de tres funciones concretas.
    private static final String[] OFF = {
        // --- Decompilador: basta el basico ---
        "Decompiler Parameter ID",
        "Decompiler Switch Analysis",

        // --- Deteccion de funciones: muy costosa en binarios grandes ---
        "Function ID",
        "Non-Returning Functions - Discovered",
        "Non-Returning Functions - Discovered - Aggressive",
        "Function Start Search",

        // --- Simbolos ---
        "Dynamic Symbol Search",

        // --- Datos: de alto coste y sin valor aqui ---
        "DWARF",
        "Embedded Media",
        "Pcode Attributes",
        "Windows x86 Constant Analyzer",
        "x86-64 Constant Analyzer",
        "Aggressive x86-64 Constant Analyzer",

        // --- Redundantes para este objetivo ---
        "Reference Analysis",
        "Aggressive Instruction Finder",
        "Decompiler Parameter ID",
        "Decompiler Switch Analysis",
        "Decompile C++ Annotations",
        "Stack Pointer Create",
        "Equate Flow",
        "ASCII Strings",
        "Comment Outliers",
        "Subroutine View",
    };

    @Override
    public void run() throws Exception {
        Program p = currentProgram;
        println("SlimAnalysis: recortando analizadores para " + p.getName());

        Options o = p.getOptions(Program.GHIDRA_PROGRAM_OPTIONS) != null
            ? p.getOptions(Program.GHIDRA_PROGRAM_OPTIONS)
            : null;

        int aplicados = 0;
        if (o != null) {
            for (String k : OFF) {
                try {
                    if (o.getOption(k) != null && !"false".equals(o.getOption(k).getValueAsString())) {
                        o.setOption(k, "false");
                        aplicados++;
                    }
                } catch (Exception e) {
                    // la clave puede no existir en esta version; se ignora
                }
            }
            // Limites de analisis agresivos
            trySet(o, "Non-Returning Functions - Discovered", "false");
            trySet(o, "Decompiler Parameter ID", "false");
            trySet(o, "Function ID", "false");
            trySet(o, "Dynamic Symbol Search", "false");
            trySet(o, "Analysis Context - Pre Analysis", "false");
            trySet(o, "Decompiler CFG Correction", "false");
            trySet(o, "Decompiler CFG Recovery", "false");
        }

        println("SlimAnalysis: " + aplicados + " analizadores desactivados");
        println("SLIM_ANALYSIS_OK");
    }

    private void trySet(Options o, String k, String v) {
        try {
            if (o.getOption(k) != null) o.setOption(k, v);
        } catch (Exception e) { }
    }
}