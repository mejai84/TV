// DecompileTargets.java  --  GhidraScript headless
// Fase 10: descompila funciones objetivo de libranger-jni.so.
//
// Uso: -postScript DecompileTargets (salida addr) [...] [maxCallees]

//@category Analysis

import java.io.File;
import java.io.PrintWriter;
import java.util.Map;
import java.util.TreeMap;

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.Reference;

public class DecompileTargets extends GhidraScript {

    private static final int DECOMP_TIMEOUT = 180;

    @Override
    public void run() throws Exception {

        String[] args = getScriptArgs();
        if (args.length < 2) {
            println("uso: DecompileTargets (salida addr) [...] [maxCallees]");
            return;
        }
        boolean ultimo = (args.length % 2) == 1;
        int n = ultimo ? (args.length - 1) / 2 : args.length / 2;
        String[] outs  = new String[n];
        long[]   addrs = new long[n];
        for (int i = 0; i < n; i++) {
            outs[i]  = args[i * 2];
            addrs[i] = Long.parseLong(args[i * 2 + 1], 16);
        }
        int maxCallees = ultimo ? Integer.parseInt(args[args.length - 1]) : 8;
        println("DecompileTargets: " + n + " objetivos");

        Address IMAGE = currentProgram.getImageBase();
        println("  Imagen base : " + IMAGE);
        println("  Lenguaje    : " + currentProgram.getLanguageID());
        println("  Compilador  : " + currentProgram.getCompilerSpec().getCompilerSpecID());
        println("  SHA256      : " + currentProgram.getExecutableSHA256());

        // informe global
        File info = new File(outs[0].replace(".c", "_INFO.txt"));
        PrintWriter w = new PrintWriter(info, "UTF-8");
        w.println("=== FASE 10 - RESUMEN DEL BINARIO (Ghidra) ===");
        w.println("SHA256   : " + currentProgram.getExecutableSHA256());
        w.println("Formato  : " + currentProgram.getExecutableFormat());
        w.println("Lenguaje : " + currentProgram.getLanguageID());
        w.println("Imagen   : " + IMAGE);
        w.println("Funciones: " + currentProgram.getFunctionManager().getFunctionCount());
        MemoryBlock t = currentProgram.getMemory().getBlock(".text");
        if (t != null) {
            w.println(".text    : " + t.getStart() + " .. " + t.getEnd() + " (" + t.getSize() + " B)");
        }
        w.close();

        DecompInterface di = new DecompInterface();
        DecompileOptions dopts = new DecompileOptions();
        dopts.setEliminateUnreachable(true);
        dopts.setCommentStyle(DecompileOptions.CommentStyleEnum.CPPStyle);
        dopts.setMaxPayloadMBytes(64);
        di.setOptions(dopts);
        di.setSimplificationStyle("decompile");
        if (!di.openProgram(currentProgram)) {
            println("ERROR: el decompilador no abrio el programa");
            return;
        }

        for (int i = 0; i < n; i++) {
            Address a = IMAGE.add(addrs[i]);
            Function f = getFunctionAt(a);
            if (f == null) f = getFunctionContaining(a);

            PrintWriter o = new PrintWriter(new File(outs[i]), "UTF-8");
            o.println("/* =========================================================");
            o.println(" * FASE 10 - DESCOMPILACION (Ghidra " + "12.1.4" + ")");
            o.println(" * solicitada : 0x" + Long.toHexString(addrs[i]));
            if (f != null) {
                o.println(" * funcion    : " + f.getName() + "   @ " + f.getEntryPoint());
                o.println(" * rango      : " + f.getBody().getMinAddress() + " .. "
                        + f.getBody().getMaxAddress() + "  (" + f.getBody().getNumAddresses() + " B)");
                o.println(" * tipo/sig   : " + f.getSignature().getPrototypeString());
                o.println(" * namespace  : " + f.getParentNamespace().getName(true));
                o.println(" * clase      : " + f.getParentNamespace().getSymbol().getName());
                o.println(" * llámantes  : " + f.getCallingFunctions(monitor).size());
                o.println(" * llamadas   : " + f.getCalledFunctions(monitor).size());
            } else {
                o.println(" * FUNCION NO ENCONTRADA");
            }
            o.println(" * ========================================================= */");
            o.println();

            if (f != null) {
                DecompileResults res = di.decompileFunction(f, DECOMP_TIMEOUT, monitor);
                o.println("/* ---------- PSEUDOCODIGO ---------- */");
                if (res != null && res.decompileCompleted() && res.getDecompiledFunction() != null) {
                    String c = res.getDecompiledFunction().getC();
                    o.println(c);
                    println("[+] 0x" + Long.toHexString(addrs[i]) + " " + f.getName()
                            + "  " + c.length() + " chars");
                } else {
                    o.println("/* descompilacion fallida */");
                    println("[-] 0x" + Long.toHexString(addrs[i]) + " FALLO");
                }

                o.println("\n/* ---------- LLAMANTES ---------- */");
                for (Function cf : f.getCallingFunctions(monitor)) {
                    o.println("   " + cf.getEntryPoint() + "  " + cf.getName()
                            + "  [" + cf.getParentNamespace().getName(true) + "]");
                }
                o.println("\n/* ---------- LLAMADAS ---------- */");
                int k = 0;
                for (Function tf : f.getCalledFunctions(monitor)) {
                    o.println("   " + tf.getEntryPoint() + "  " + tf.getName()
                            + "  [" + tf.getParentNamespace().getName(true) + "]");
                    if (++k >= maxCallees) { o.println("   ... truncado"); break; }
                }

                // constantes inmediatas: solo dentro del cuerpo de la funcion
                o.println("\n/* ---------- CONSTANTES INMEDIATAS EN EL RANGO ---------- */");
                Map<String, String> lits = new TreeMap<String, String>();
                Listing lst = currentProgram.getListing();
                java.util.Iterator<Instruction> it = lst.getInstructions(f.getBody(), true);
                while (it.hasNext()) {
                    Instruction ins = it.next();
                    String s = ins.toString();
                    int sp = s.indexOf("#0x");
                    if (sp > 0) {
                        String val = s.substring(sp);
                        if (val.length() > 3) lits.put(ins.getAddress().toString(), s);
                    }
                }
                for (Map.Entry<String, String> e : lits.entrySet()) {
                    o.println("   " + e.getValue());
                }
                o.println("   (" + lits.size() + ")");

                // cadenas referenciadas SOLO dentro del rango de la funcion
                o.println("\n/* ---------- CADENAS REFERENCIADAS EN EL RANGO ---------- */");
                Memory mem = currentProgram.getMemory();
                java.util.Iterator<Instruction> it2 = lst.getInstructions(f.getBody(), true);
                int c = 0;
                while (it2.hasNext()) {
                    Instruction ins = it2.next();
                    for (Reference r : getReferencesFrom(ins.getAddress())) {
                        Address to = r.getToAddress();
                        if (!mem.contains(to)) continue;
                        String s = leerAscii(mem, to, 220);
                        if (s != null && s.length() >= 2) {
                            o.println("   " + ins.getAddress() + "  ->  " + s.replace("\n", " "));
                            c++;
                        }
                    }
                }
                o.println("   (" + c + ")");
            }
            o.close();
            println("[OK] " + outs[i]);
        }

        Runtime rt = Runtime.getRuntime();
        println("Heap usado: " + (rt.totalMemory() - rt.freeMemory()) / (1024 * 1024)
                + " MB de " + rt.maxMemory() / (1024 * 1024) + " MB");
        di.dispose();
        println("DECOMPILE_TARGETS_FIN_OK");
    }

    private String leerAscii(Memory mem, Address a, int max) {
        StringBuilder sb = new StringBuilder();
        try {
            for (int i = 0; i < max; i++) {
                int c = mem.getByte(a.add(i)) & 0xFF;
                if (c == 0) break;
                if (c < 32 || c > 126) return null;
                sb.append((char) c);
            }
        } catch (Exception e) { return null; }
        return sb.length() > 0 ? sb.toString() : null;
    }
}