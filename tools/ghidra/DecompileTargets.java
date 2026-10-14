// DecompileTargets.java  --  GhidraScript headless
// Fase 10: descompila las funciones objetivo de libranger-jni.so y traza
// la procedencia del valor que acaba en Status.play_url.
//
// Uso: -postScript DecompileTargets.java <salida1> <salida2> <salida3>
//       <addr1> <addr2> <addr3> [maxCallees]

//@category Analysis
//@keybinding
//@menupath
//@toolbar

import java.io.File;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.List;

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressIterator;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;

public class DecompileTargets extends GhidraScript {

    private static final int DECOMP_TIMEOUT = 180; // segundos por funcion

    @Override
    public void run() throws Exception {

        // Uso: DecompileTargets <salida> <addr> [<salida> <addr> ...] [maxCallees]
        // Las parejas van al principio; un ultimo argumento suelto = maxCallees
        String[] args = getScriptArgs();
        if (args.length < 2) {
            println("uso: DecompileTargets (salida addr) [...] [maxCallees]");
            return;
        }
        int n = args.length / 2;
        boolean ultimoSuelto = (args.length % 2) == 1;
        String[] outs  = new String[n];
        long[]   addrs = new long[n];
        int last = ultimoSuelto ? n - 1 : n;
        for (int i = 0; i < last; i++) {
            outs[i]  = args[i * 2];
            addrs[i] = Long.parseLong(args[i * 2 + 1], 16);
        }
        int maxCallees = ultimoSuelto ? Integer.parseInt(args[args.length - 1]) : 8;
        println("Objetivos: " + last);

        Address IMAGE = currentProgram.getImageBase();
        println("Imagen base: " + IMAGE);
        println("Lenguaje    : " + currentProgram.getLanguageID());
        println("Compilador  : " + currentProgram.getCompilerSpec().getCompilerSpecID());
        println("Rebase      : " + currentProgram.getImageBase());

        // ---------- informe del binario ----------
        File informe = new File(args[0].replace(".c", "_INFO.txt"));
        PrintWriter w = new PrintWriter(informe, "UTF-8");
        w.println("=== FASE 10 - GHOSTRA RESUMEN DEL BINARIO ===");
        w.println("Fichero     : " + currentProgram.getExecutablePath());
        w.println("Lenguaje    : " + currentProgram.getLanguageID());
        w.println("Compilador  : " + currentProgram.getCompilerSpec().getCompilerSpecID());
        w.println("Formato     : " + currentProgram.getExecutableFormat());
        w.println("Imagen base : " + IMAGE);
        w.println("MD5         : " + currentProgram.getExecutableMD5());
        w.println("SHA256      : " + currentProgram.getExecutableSHA256());
        w.println();
        MemoryBlock txt = currentProgram.getMemory().getBlock(".text");
        if (txt != null) {
            w.println(".text       : " + txt.getStart() + " .. " + txt.getEnd()
                    + "   (" + txt.getSize() + " bytes)");
        }
        int nFunc = currentProgram.getFunctionManager().getFunctionCount();
        w.println("Funciones creadas por el analizador: " + nFunc);
        int nSym = currentProgram.getSymbolTable().getNumSymbols();
        w.println("Simbolos: " + nSym);
        w.close();

        DecompInterface di = new DecompInterface();
        DecompileOptions dopts = new DecompileOptions();
        dopts.setEliminateUnreachable(true);
        dopts.setEliminateDuplicateConstants(true);
        dopts.setMaxPayloadMBytes(64);
        dopts.setCommentStyle(DecompileOptions.CommentStyleEnum.CPPStyle);
        di.setOptions(dopts);
        di.setSimplificationStyle("decompile");
        if (!di.openProgram(currentProgram)) {
            println("ERROR: no se pudo abrir el programa en el decompilador");
            return;
        }

        for (int i = 0; i < last; i++) {
            Address a = IMAGE.add(addrs[i]);
            Address fin = IMAGE.add(addrs[i] + 0x10000);

            Function f = getFunctionAt(a);
            if (f == null) {
                Function f2 = getFunctionContaining(a);
                if (f2 != null) {
                    println("[!] 0x" + addrs[i] + " cae dentro de " + f2.getName()
                            + " en " + f2.getEntryPoint());
                    f = f2;
                }
            }

            PrintWriter o = new PrintWriter(new File(outs[i]), "UTF-8");
            o.println("/* ==========================================================");
            o.println(" * FASE 10 - DESCOMPILACION");
            o.println(" * Direccion solicitada : 0x" + Long.toHexString(addrs[i]));
            if (f != null) {
                o.println(" * Funcion            : " + f.getName());
                o.println(" * EntryPoint         : " + f.getEntryPoint());
                o.println(" * Rango              : " + f.getBody().getMinAddress()
                        + " .. " + f.getBody().getMaxAddress()
                        + "  (" + f.getBody().getNumAddresses() + " bytes)");
                o.println(" * Firma              : " + f.getSignature());
                o.println(" * Llamadas           : " + f.getCallingFunctions(monitor).size());
                o.println(" * Llamadas internas : " + f.getCalledFunctions(monitor).size());
                o.println(" * Thunks            : " + f.getThunkedFunction(true) != null);
            } else {
                o.println(" * FUNCION NO ENCONTRADA en 0x" + Long.toHexString(addrs[i]));
            }
            o.println(" * ========================================================== */");
            o.println();

            if (f != null) {
                // ---- descompilacion ----
                DecompileResults res = di.decompileFunction(f, DECOMP_TIMEOUT, monitor);
                o.println("/* ---------- PSEUDOCODIGO ---------- */");
                if (res != null && res.decompileCompleted() && res.getDecompiledFunction() != null) {
                    String c = res.getDecompiledFunction().getC();
                    o.println(c);
                    o.println();
                    o.println("/* ---------- fin del pseudocodo ---------- */");
                    o.println();
                    println("[+] 0x" + addrs[i] + " " + f.getName()
                            + " decompilada (" + c.length() + " chars), error="
                            + (res.decompileCompleted() ? "ninguno" : "TIMEOUT/ERROR"));
                } else {
                    o.println("/* descompilacion fallida: completed=" +
                            (res != null ? res.decompileCompleted() : "null") + " */");
                    println("[-] 0x" + addrs[i] + " FALLO de descompilacion");
                }

                // ---- referencias cruzadas ----
                o.println("\n/* ---------- REFERENCIAS CRUZADAS ---------- */");
                o.println("\n-- LLAMANTES (quien llama a esta funcion) --");
                for (Function cf : f.getCallingFunctions(monitor)) {
                    o.println("   " + cf.getEntryPoint() + "  " + cf.getName()
                            + "   (en " + cf.getBody().getMinAddress() + ")");
                }
                o.println("\n-- LLAMADAS (a quien llama esta funcion) --");
                int nc = 0;
                for (Function tf : f.getCalledFunctions(monitor)) {
                    o.println("   " + tf.getEntryPoint() + "  " + tf.getName());
                    if (++nc >= maxCallees) {
                        o.println("   ... (truncado a " + maxCallees + ")");
                        break;
                    }
                }
                o.println("\n-- REFERENCIAS A LA DIRECCION DE ENTRADA --");
                ReferenceIterator ri = getReferencesTo(f.getEntryPoint());
                while (ri.hasNext()) {
                    Reference r = ri.next();
                    o.println("   desde " + r.getFromAddress() + "  tipo " + r.getReferenceType());
                }

                // ---- literales referenciados (umbrales numericos) ----
                o.println("\n-- CONSTANTES INMEDIATAS USADAS (umbrales) --");
                AddressIterator ii = f.getBody().getMinAddress().getMaxAddress() != null
                        ? currentProgram.getListing().getInstructions(f.getBody(), true)
                        : null;
                java.util.TreeMap<String, String> lits = new java.util.TreeMap<String, String>();
                if (ii != null) {
                    while (ii.hasNext() && !monitor.isCancelled()) {
                        Instruction ins = (Instruction) ii.next();
                        String s = ins.toString();
                        int sp = s.indexOf("#0x");
                        if (sp > 0) {
                            String val = s.substring(sp);
                            if (val.length() > 4) {
                                lits.put(ins.getAddress().toString() + "  " + val, s);
                            }
                        }
                    }
                }
                for (java.util.Map.Entry<String, String> e : lits.entrySet()) {
                    o.println("   " + e.getValue());
                }
                o.println("   (" + lits.size() + " constantes)");
            }

            // ---- cadenas referenciadas en el rango ----
            o.println("\n/* ---------- CADENAS REFERENCIADAS EN EL RANGO ---------- */");
            Address[] rng = { a, fin };
            AddressIterator ri2 = currentProgram.getListing().getInstructions(true);
            int cuenta = 0;
            while (ri2.hasNext()) {
                Address x = ri2.next();
                if (x.compareTo(a) < 0 || x.compareTo(fin) >= 0) continue;
                for (Reference r : getReferencesFrom(x)) {
                    Address to = r.getToAddress();
                    Memory mem = currentProgram.getMemory();
                    if (!mem.contains(to)) continue;
                    String s = readAscii(mem, to, 200);
                    if (s != null && s.length() >= 2) {
                        o.println("   " + x + " -> 0x" + to.toString().substring(to.toString().indexOf(":") + 1)
                                + "  " + s.replace("\n", " "));
                        cuenta++;
                    }
                }
            }
            o.println("   (" + cuenta + " referencias a cadenas)");

            o.close();
            println("[OK] escrito " + outs[i]);
        }

        // ---------- resumen de memoria ----------
        Runtime rt = Runtime.getRuntime();
        println("Heap usado  : " + (rt.totalMemory() - rt.freeMemory()) / (1024 * 1024) + " MB");
        println("Heap total  : " + rt.totalMemory() / (1024 * 1024) + " MB");
        println("Heap max    : " + rt.maxMemory() / (1024 * 1024) + " MB");

        di.dispose();
        println("DECOMPILE_TARGETS_FIN_OK");
    }

    private String readAscii(Memory mem, Address a, int max) {
        StringBuilder sb = new StringBuilder();
        try {
            for (int i = 0; i < max; i++) {
                int c = mem.getByte(a.add(i)) & 0xFF;
                if (c == 0) break;
                if (c < 32 || c > 126) return null;
                sb.append((char) c);
            }
        } catch (Exception e) {
            return null;
        }
        return sb.length() > 0 ? sb.toString() : null;
    }
}