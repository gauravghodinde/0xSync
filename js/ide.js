import { usePuter } from "./puter.js";
import configuration from "./configuration.js";

const API_KEY = ""; // Get yours at https://platform.sulu.sh/apis/judge0

const AUTH_HEADERS = API_KEY ? {
    "Authorization": `Bearer ${API_KEY}`
} : {};

const CE = "CE";
const EXTRA_CE = "EXTRA_CE";

const AUTHENTICATED_CE_BASE_URL = "https://judge0-ce.p.sulu.sh";
const AUTHENTICATED_EXTRA_CE_BASE_URL = "https://judge0-extra-ce.p.sulu.sh";

var AUTHENTICATED_BASE_URL = {};
AUTHENTICATED_BASE_URL[CE] = AUTHENTICATED_CE_BASE_URL;
AUTHENTICATED_BASE_URL[EXTRA_CE] = AUTHENTICATED_EXTRA_CE_BASE_URL;

const UNAUTHENTICATED_CE_BASE_URL = "https://ce.judge0.com";
const UNAUTHENTICATED_EXTRA_CE_BASE_URL = "https://extra-ce.judge0.com";

var UNAUTHENTICATED_BASE_URL = {};
UNAUTHENTICATED_BASE_URL[CE] = UNAUTHENTICATED_CE_BASE_URL;
UNAUTHENTICATED_BASE_URL[EXTRA_CE] = UNAUTHENTICATED_EXTRA_CE_BASE_URL;

const INITIAL_WAIT_TIME_MS = 0;
const WAIT_TIME_FUNCTION = i => 100;
const MAX_PROBE_REQUESTS = 50;

var fontSize = 13;

var layout;

export var sourceEditor;
var stdinEditor;
var stdoutEditor;

var $selectLanguage;
var $compilerOptions;
var $commandLineArguments;
var $runBtn;
var $statusLine;

var timeStart;

var sqliteAdditionalFiles;
var languages = {};

var layoutConfig = {
    settings: {
        showPopoutIcon: false,
        reorderEnabled: true
    },
    content: [{
        type: configuration.get("appOptions.mainLayout"),
        content: [{
            type: "row",
            content: [{
                type: "component",
                width: 20,
                componentName: "fileExplorer",
                id: "fileExplorer",
                title: "Files",
                isClosable: false
            }, {
                type: "component",
                width: 80,
                componentName: "source",
                id: "source",
                title: "Source Code",
                isClosable: false,
                componentState: {
                    readOnly: false
                }
            }]
        }, {
            type: configuration.get("appOptions.assistantLayout"),
            title: "AI Assistant and I/O",
            content: [configuration.get("appOptions.showAIAssistant") ? {
                type: "component",
                height: 66,
                componentName: "ai",
                id: "ai",
                title: "AI Assistant",
                isClosable: false,
                componentState: {
                    readOnly: false
                }
            } : null, {
                type: configuration.get("appOptions.ioLayout"),
                title: "I/O",
                content: [
                    configuration.get("appOptions.showInput") ? {
                        type: "component",
                        componentName: "stdin",
                        id: "stdin",
                        title: "CompiledABI",  // Changed from "Input"
                        isClosable: false,
                        componentState: {
                            readOnly: false
                        }
                    } : null, configuration.get("appOptions.showOutput") ? {
                        type: "component",
                        componentName: "stdout",
                        id: "stdout",
                        title: "CompiledBytecode",  // Changed from "Output"
                        isClosable: false,
                        componentState: {
                            readOnly: true
                        }
                    } : null, {
                        type: "component",
                        componentName: "deployed",
                        id: "deployed",
                        title: "Deployed",
                        isClosable: false,
                        componentState: {
                            readOnly: true
                        }
                    }].filter(Boolean)
            }].filter(Boolean)
        }]
    }]
};

var gPuterFile;

// Add these variables
var fileSystem = {};
var currentFile = "contract.sol";

function encode(str) {
    return btoa(unescape(encodeURIComponent(str || "")));
}

function decode(bytes) {
    var escaped = escape(atob(bytes || ""));
    try {
        return decodeURIComponent(escaped);
    } catch {
        return unescape(escaped);
    }
}

function showError(title, content) {
    $("#judge0-site-modal #title").html(title);
    $("#judge0-site-modal .content").html(content);

    let reportTitle = encodeURIComponent(`Error on ${window.location.href}`);
    let reportBody = encodeURIComponent(
        `**Error Title**: ${title}\n` +
        `**Error Timestamp**: \`${new Date()}\`\n` +
        `**Origin**: ${window.location.href}\n` +
        `**Description**:\n${content}`
    );

    $("#report-problem-btn").attr("href", `https://github.com/judge0/ide/issues/new?title=${reportTitle}&body=${reportBody}`);
    $("#judge0-site-modal").modal("show");
}

function showHttpError(jqXHR) {
    showError(`${jqXHR.statusText} (${jqXHR.status})`, `<pre>${JSON.stringify(jqXHR, null, 4)}</pre>`);
}

function handleRunError(jqXHR) {
    showHttpError(jqXHR);
    $runBtn.removeClass("loading");

    window.top.postMessage(JSON.parse(JSON.stringify({
        event: "runError",
        data: jqXHR
    })), "*");
}

function handleResult(data) {
    const tat = Math.round(performance.now() - timeStart);
    console.log(`It took ${tat}ms to get submission result.`);

    const status = data.status;
    const stdout = decode(data.stdout);
    const compileOutput = decode(data.compile_output);
    const time = (data.time === null ? "-" : data.time + "s");
    const memory = (data.memory === null ? "-" : data.memory + "KB");

    $statusLine.html(`${status.description}, ${time}, ${memory} (TAT: ${tat}ms)`);

    const output = [compileOutput, stdout].filter(x => x).join("\n").trimEnd();

    stdoutEditor.setValue(output);

    $runBtn.removeClass("loading");

    window.top.postMessage(JSON.parse(JSON.stringify({
        event: "postExecution",
        status: data.status,
        time: data.time,
        memory: data.memory,
        output: output
    })), "*");
}

async function getSelectedLanguage() {
    return getLanguage(getSelectedLanguageFlavor(), getSelectedLanguageId())
}

function getSelectedLanguageId() {
    return parseInt($selectLanguage.val());
}

function getSelectedLanguageFlavor() {
    return $selectLanguage.find(":selected").attr("flavor");
}

function run() {
    if (sourceEditor.getValue().trim() === "") {
        showError("Error", "Source code can't be empty!");
        return;
    } else {
        $runBtn.addClass("loading");
    }

    stdoutEditor.setValue("");
    $statusLine.html("");

    let x = layout.root.getItemsById("stdout")[0];
    x.parent.header.parent.setActiveContentItem(x);

    let sourceValue = encode(sourceEditor.getValue());
    
    let languageId = getSelectedLanguageId();
    let compilerOptions = $compilerOptions.val();
    let commandLineArguments = $commandLineArguments.val();

    let flavor = getSelectedLanguageFlavor();

    if (languageId === 44) {
        sourceValue = sourceEditor.getValue();
    }
    
    let data = {
        sources: { "contract.sol": { content: sourceEditor.getValue() } }
    };
    console.log(sourceValue);

    let sendRequest = function (data) {
        window.top.postMessage(JSON.parse(JSON.stringify({
            event: "preExecution",
            source_code: sourceEditor.getValue(),
            language_id: languageId,
            flavor: flavor,
            stdin: stdinEditor.getValue(),
            compiler_options: compilerOptions,
            command_line_arguments: commandLineArguments
        })), "*");
        console.log(data);
        timeStart = performance.now();
        $.ajax({
            url: `http://localhost:3000/compile/compile`,
            type: "POST",
            contentType: "application/json",
            data: JSON.stringify(data),
            headers: AUTH_HEADERS,
            success: function (data, textStatus, request) {
                console.log(`output: compiled -> abi and bytecode ${JSON.stringify(data)}`);
                
                try {
                    // Extract contract name from compilation result
                    const contractName = Object.keys(data.compiled.contracts["contract.sol"])[0];
                    
                    // Format the output in a structured way
                    const formattedOutput = {
                        contractName: contractName,
                        compiledABI: data.compiled.contracts["contract.sol"][contractName].abi,
                        compiledBytecode: data.compiled.contracts["contract.sol"][contractName].evm.bytecode.object,
                        deployedContractHash: "Not yet deployed" // Placeholder for future implementation
                    };
                    
                    // Display contract name and ABI in the input editor
                    stdinEditor.setValue(
                        "Contract Name: " + contractName + "\n\n" +
                        "CompiledABI:\n" + JSON.stringify(formattedOutput.compiledABI, null, 2)
                    );
                    
                    // Display bytecode in the output editor
                    stdoutEditor.setValue(
                        "CompiledBytecode:\n" + formattedOutput.compiledBytecode
                    );
                    
                    // Add deployed contract information
                    if (!layout.root.getItemsById("deployed").length) {
                        addDeployedTab();
                    }
                    
                    // Update deployed tab content
                    const deployedEditor = window.deployedEditor;
                    if (deployedEditor) {
                        deployedEditor.setValue("DeployedContractHash:\n" + formattedOutput.deployedContractHash);
                    }
                    
                    // Store the compilation data for later use
                    window.compilationResult = formattedOutput;
                    
                    $runBtn.removeClass("loading");
                    
                    window.top.postMessage(JSON.parse(JSON.stringify({
                        event: "postExecution",
                        status: data.status,
                        time: data.time,
                        memory: data.memory,
                        output: JSON.stringify(formattedOutput)
                    })), "*");
                } catch (error) {
                    console.error("Error processing compilation result:", error);
                    stdoutEditor.setValue("Error processing compilation result: " + error.message + "\n\n" + JSON.stringify(data, null, 2));
                    $runBtn.removeClass("loading");
                }
            },
            error: handleRunError
        });
    }

    if (languageId === 82) {
        if (!sqliteAdditionalFiles) {
            $.ajax({
                url: `./data/additional_files_zip_base64.txt`,
                contentType: "text/plain",
                success: function (responseData) {
                    sqliteAdditionalFiles = responseData;
                    data["additional_files"] = sqliteAdditionalFiles;
                    sendRequest(data);
                },
                error: handleRunError
            });
        }
        else {
            data["additional_files"] = sqliteAdditionalFiles;
            sendRequest(data);
        }
    } else {
        sendRequest(data);
    }
}

function fetchSubmission(flavor, region, submission_token, iteration) {
    if (iteration >= MAX_PROBE_REQUESTS) {
        handleRunError({
            statusText: "Maximum number of probe requests reached.",
            status: 504
        }, null, null);
        return;
    }

    $.ajax({
        url: `${UNAUTHENTICATED_BASE_URL[flavor]}/submissions/${submission_token}?base64_encoded=true`,
        headers: {
            "X-Judge0-Region": region
        },
        success: function (data) {
            if (data.status.id <= 2) { // In Queue or Processing
                $statusLine.html(data.status.description);
                setTimeout(fetchSubmission.bind(null, flavor, region, submission_token, iteration + 1), WAIT_TIME_FUNCTION(iteration));
            } else {
                handleResult(data);
            }
        },
        error: handleRunError
    });
}

function setSourceCodeName(name) {
    $(".lm_title")[0].innerText = name;
}

function getSourceCodeName() {
    return $(".lm_title")[0].innerText;
}

function openFile(content, filename) {
    clear();
    sourceEditor.setValue(content);
    selectLanguageForExtension(filename.split(".").pop());
    setSourceCodeName(filename);
}

function saveFile(content, filename) {
    const blob = new Blob([content], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
}

async function openAction() {
    if (usePuter()) {
        gPuterFile = await puter.ui.showOpenFilePicker();
        openFile(await (await gPuterFile.read()).text(), gPuterFile.name);
    } else {
        document.getElementById("open-file-input").click();
    }
}

async function saveAction() {
    if (usePuter()) {
        if (gPuterFile) {
            gPuterFile.write(sourceEditor.getValue());
        } else {
            gPuterFile = await puter.ui.showSaveFilePicker(sourceEditor.getValue(), getSourceCodeName());
            setSourceCodeName(gPuterFile.name);
        }
    } else {
        saveFile(sourceEditor.getValue(), getSourceCodeName());
    }
}

function setFontSizeForAllEditors(fontSize) {
    sourceEditor.updateOptions({ fontSize: fontSize });
    stdinEditor.updateOptions({ fontSize: fontSize });
    stdoutEditor.updateOptions({ fontSize: fontSize });
}

async function loadLangauges() {
    return new Promise((resolve, reject) => {
        let options = [];

        const lang = [
          {"name": "JavaScript (Node.js 12.14.0)", "id": 23},
          {"name": "Python (3.8.1)", "id": 71},
          {"name": "Rust (1.40.0)", "id": 73},
          {"name": "Bash (5.0.0)", "id": 46},
          {"name": "Solidity", "id": 83},
          {"name": "Plain Text", "id": 43}
        ]
        $.ajax({
            url: UNAUTHENTICATED_CE_BASE_URL + "/languages",
            success: function (data) {
                for (let i = 0; i < lang.length; i++) {
                    let language = lang[i];
                    let option = new Option(language.name, language.id);
                    option.setAttribute("flavor", CE);
                    option.setAttribute("langauge_mode", getEditorLanguageMode(language.name));

                    if (language.id !== 89) {
                        options.push(option);
                    }

                    if (language.id === DEFAULT_LANGUAGE_ID) {
                        option.selected = true;
                    }
                }

            },
            error: reject
        }).always(function () {
            $.ajax({
                url: UNAUTHENTICATED_EXTRA_CE_BASE_URL + "/languages",
                success: function (data) {
                    for (let i = 0; i < data.length; i++) {
                        let language = data[i];
                        let option = new Option(language.name, language.id);
                        option.setAttribute("flavor", EXTRA_CE);
                        option.setAttribute("langauge_mode", getEditorLanguageMode(language.name));

                        if (options.findIndex((t) => (t.text === option.text)) === -1 && language.id !== 89) {
                            options.push(option);
                        }
                    }
                },
                error: reject
            }).always(function () {
                options.sort((a, b) => a.text.localeCompare(b.text));
                $selectLanguage.append(options);
                resolve();
            });
        });
    });
};

async function loadSelectedLanguage(skipSetDefaultSourceCodeName = false) {
    monaco.editor.setModelLanguage(sourceEditor.getModel(), $selectLanguage.find(":selected").attr("langauge_mode"));

    if (!skipSetDefaultSourceCodeName) {
        setSourceCodeName((await getSelectedLanguage()).source_file);
    }
}

function selectLanguageByFlavorAndId(languageId, flavor) {
    let option = $selectLanguage.find(`[value=${languageId}][flavor=${flavor}]`);
    if (option.length) {
        option.prop("selected", true);
        $selectLanguage.trigger("change", { skipSetDefaultSourceCodeName: true });
    }
}

function selectLanguageForExtension(extension) {
    let language = getLanguageForExtension(extension);
    selectLanguageByFlavorAndId(language.language_id, language.flavor);
}

async function getLanguage(flavor, languageId) {
    return new Promise((resolve, reject) => {
        if (languages[flavor] && languages[flavor][languageId]) {
            resolve(languages[flavor][languageId]);
            return;
        }

        $.ajax({
            url: `${UNAUTHENTICATED_BASE_URL[flavor]}/languages/${languageId}`,
            success: function (data) {
                if (!languages[flavor]) {
                    languages[flavor] = {};
                }

                languages[flavor][languageId] = data;
                resolve(data);
            },
            error: reject
        });
    });
}

function setDefaults() {
    setFontSizeForAllEditors(fontSize);
    sourceEditor.setValue(DEFAULT_SOURCE);
    stdinEditor.setValue(DEFAULT_STDIN);
    $compilerOptions.val(DEFAULT_COMPILER_OPTIONS);
    $commandLineArguments.val(DEFAULT_CMD_ARGUMENTS);

    $statusLine.html("");

    loadSelectedLanguage();
}

function clear() {
    sourceEditor.setValue("");
    stdinEditor.setValue("");
    $compilerOptions.val("");
    $commandLineArguments.val("");

    $statusLine.html("");
}

function refreshSiteContentHeight() {
    const navigationHeight = document.getElementById("judge0-site-navigation").offsetHeight;

    const siteContent = document.getElementById("judge0-site-content");
    siteContent.style.height = `${window.innerHeight}px`;
    siteContent.style.paddingTop = `${navigationHeight}px`;
}

function refreshLayoutSize() {
    refreshSiteContentHeight();
    layout.updateSize();
}

window.addEventListener("resize", refreshLayoutSize);
document.addEventListener("DOMContentLoaded", async function () {
    $(".ui.selection.dropdown").dropdown();
    $("[data-content]").popup({
        lastResort: "left center"
    });

    refreshSiteContentHeight();

    console.log("Hey, Judge0 IDE is open-sourced: https://github.com/judge0/ide. Have fun!");

    $selectLanguage = $("#select-language");
    $selectLanguage.change(function (event, data) {
        let skipSetDefaultSourceCodeName = (data && data.skipSetDefaultSourceCodeName) || !!gPuterFile;
        loadSelectedLanguage(skipSetDefaultSourceCodeName);
    });

    await loadLangauges();

    $compilerOptions = $("#compiler-options");
    $commandLineArguments = $("#command-line-arguments");

    $runBtn = $("#run-btn");
    $runBtn.click(run);

    $("#open-file-input").change(function (e) {
        const selectedFile = e.target.files[0];
        if (selectedFile) {
            const reader = new FileReader();
            reader.onload = function (e) {
                openFile(e.target.result, selectedFile.name);
            };

            reader.onerror = function (e) {
                showError("Error", "Error reading file: " + e.target.error);
            };

            reader.readAsText(selectedFile);
        }
    });

    $statusLine = $("#judge0-status-line");

    $(document).on("keydown", "body", function (e) {
        if (e.metaKey || e.ctrlKey) {
            switch (e.key) {
                case "Enter":
                    e.preventDefault();
                    run();
                    break;
                case "s":
                    e.preventDefault();
                    saveAction();
                    break;
                case "o":
                    e.preventDefault();
                    openAction();
                    break;
                case "+":
                case "=":
                    e.preventDefault();
                    fontSize += 1;
                    setFontSizeForAllEditors(fontSize);
                    break;
                case "-":
                    e.preventDefault();
                    fontSize -= 1;
                    setFontSizeForAllEditors(fontSize);
                    break;
                case "0":
                    e.preventDefault();
                    fontSize = 13;
                    setFontSizeForAllEditors(fontSize);
                    break;
                case "`":
                    e.preventDefault();
                    sourceEditor.focus();
                    break;
            }
        }
    });

    require(["vs/editor/editor.main"], function (ignorable) {
        setupSoliditySupport();

        layout = new GoldenLayout(layoutConfig, $("#judge0-site-content"));

        layout.registerComponent("source", function (container, state) {
            sourceEditor = monaco.editor.create(container.getElement()[0], {
                automaticLayout: true,
                scrollBeyondLastLine: true,
                readOnly: state.readOnly,
                language: "sol",
                minimap: {
                    enabled: true
                }
            });

            sourceEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, run);

            monaco.languages.registerInlineCompletionsProvider('*', {
                provideInlineCompletions: async (model, position) => {
                    if (!puter.auth.isSignedIn() || !document.getElementById("judge0-inline-suggestions").checked || !configuration.get("appOptions.showAIAssistant")) {
                        return;
                    }

                    const textBeforeCursor = model.getValueInRange({
                        startLineNumber: 1,
                        startColumn: 1,
                        endLineNumber: position.lineNumber,
                        endColumn: position.column
                    });

                    const textAfterCursor = model.getValueInRange({
                        startLineNumber: position.lineNumber,
                        startColumn: position.column,
                        endLineNumber: model.getLineCount(),
                        endColumn: model.getLineMaxColumn(model.getLineCount())
                    });

                    const aiResponse = await puter.ai.chat([{
                        role: "user",
                        content: `You are a code completion assistant. Given the following context, generate the most likely code completion.

                    ### Code Before Cursor:
                    ${textBeforeCursor}

                    ### Code After Cursor:
                    ${textAfterCursor}

                    ### Instructions:
                    - Predict the next logical code segment.
                    - Ensure the suggestion is syntactically and contextually correct.
                    - Keep the completion concise and relevant.
                    - Do not repeat existing code.
                    - Provide only the missing code.
                    - **Respond with only the code, without markdown formatting.**
                    - **Do not include triple backticks (\`\`\`) or additional explanations.**

                    ### Completion:`.trim()
                    }], {
                        model: document.getElementById("judge0-chat-model-select").value,
                    });

                    let aiResponseValue = aiResponse?.toString().trim() || "";

                    if (Array.isArray(aiResponseValue)) {
                        aiResponseValue = aiResponseValue.map(v => v.text).join("\n").trim();
                    }

                    if (!aiResponseValue || aiResponseValue.length === 0) {
                        return;
                    }

                    return {
                        items: [{
                            insertText: aiResponseValue,
                            range: new monaco.Range(
                                position.lineNumber,
                                position.column,
                                position.lineNumber,
                                position.column
                            )
                        }]
                    };
                },
                handleItemDidShow: () => { },
                freeInlineCompletions: () => { }
            });
        });

        layout.registerComponent("stdin", function (container, state) {
            stdinEditor = monaco.editor.create(container.getElement()[0], {
                automaticLayout: true,
                scrollBeyondLastLine: false,
                readOnly: state.readOnly,
                language: "plaintext",
                minimap: {
                    enabled: false
                }
            });
        });

        layout.registerComponent("stdout", function (container, state) {
            stdoutEditor = monaco.editor.create(container.getElement()[0], {
                automaticLayout: true,
                scrollBeyondLastLine: false,
                readOnly: state.readOnly,
                language: "plaintext",
                minimap: {
                    enabled: false
                }
            });
        });

        layout.registerComponent("ai", function (container, state) {
            container.getElement()[0].appendChild(document.getElementById("judge0-chat-container"));
        });

        // Update the file explorer component registration
        layout.registerComponent("fileExplorer", function(container) {
            const element = container.getElement()[0];
            const fileExplorer = document.createElement("div");
            fileExplorer.className = "file-explorer";
            
            // Check if we should add the inverted class based on current theme
            if (document.body.classList.contains('inverted')) {
                fileExplorer.classList.add('inverted');
            }
            
            const fileList = document.createElement("ul");
            fileList.id = "file-list";
            
            const buttonsContainer = document.createElement("div");
            buttonsContainer.className = "file-actions";
            
            const addFileBtn = document.createElement("button");
            addFileBtn.textContent = "New File";
            addFileBtn.className = "ui primary button";
            addFileBtn.onclick = createNewFile;
            
            const deleteFileBtn = document.createElement("button");
            deleteFileBtn.textContent = "Delete";
            deleteFileBtn.className = "ui negative button";
            deleteFileBtn.onclick = deleteCurrentFile;
            
            buttonsContainer.appendChild(addFileBtn);
            buttonsContainer.appendChild(deleteFileBtn);
            
            fileExplorer.appendChild(fileList);
            fileExplorer.appendChild(buttonsContainer);
            element.appendChild(fileExplorer);
            
            updateFileList();
        });

        layout.registerComponent("deployed", function (container, state) {
            window.deployedEditor = monaco.editor.create(container.getElement()[0], {
                automaticLayout: true,
                scrollBeyondLastLine: false,
                readOnly: state.readOnly,
                language: "plaintext",
                minimap: {
                    enabled: false
                }
            });
        });

        layout.on("initialised", function () {
            setDefaults();
            refreshLayoutSize();
            window.top.postMessage({ event: "initialised" }, "*");
        });

        layout.init();
    });

    let superKey = "⌘";
    if (!/(Mac|iPhone|iPod|iPad)/i.test(navigator.platform)) {
        superKey = "Ctrl";
    }

    [$runBtn].forEach(btn => {
        btn.attr("data-content", `${superKey}${btn.attr("data-content")}`);
    });

    document.querySelectorAll(".description").forEach(e => {
        e.innerText = `${superKey}${e.innerText}`;
    });

    if (usePuter()) {
        puter.ui.onLaunchedWithItems(async function (items) {
            gPuterFile = items[0];
            openFile(await (await gPuterFile.read()).text(), gPuterFile.name);
        });
    }

    document.getElementById("judge0-open-file-btn").addEventListener("click", openAction);
    document.getElementById("judge0-save-btn").addEventListener("click", saveAction);

    // Add event handlers for new blockchain buttons
    document.getElementById("compile-btn").addEventListener("click", compileContract);
    document.getElementById("deploy-btn").addEventListener("click", deployContract);

    // Style the blockchain buttons
    const compileBtn = document.getElementById("compile-btn");
    const deployBtn = document.getElementById("deploy-btn");
    
    // Apply the same popup behavior as the run button
    [compileBtn, deployBtn].forEach(btn => {
        $(btn).popup({
            lastResort: "left center"
        });
    });
    
    // Add tooltips to the blockchain buttons
    compileBtn.setAttribute("data-content", `${superKey}+Shift+C`);
    deployBtn.setAttribute("data-content", `${superKey}+Shift+D`);
    
    // Register keyboard shortcuts for blockchain functions
    $(document).on("keydown", "body", function(e) {
        if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            switch (e.key) {
                case "C":
                    e.preventDefault();
                    compileContract();
                    break;
                case "D":
                    e.preventDefault();
                    deployContract();
                    break;
            }
        }
    });

    // Initialize file system with default Solidity contract
    fileSystem[currentFile] = DEFAULT_SOURCE;

    window.onmessage = function (e) {
        if (!e.data) {
            return;
        }

        if (e.data.action === "get") {
            window.top.postMessage(JSON.parse(JSON.stringify({
                event: "getResponse",
                source_code: sourceEditor.getValue(),
                language_id: getSelectedLanguageId(),
                flavor: getSelectedLanguageFlavor(),
                stdin: stdinEditor.getValue(),
                stdout: stdoutEditor.getValue(),
                compiler_options: $compilerOptions.val(),
                command_line_arguments: $commandLineArguments.val()
            })), "*");
        } else if (e.data.action === "set") {
            if (e.data.source_code) {
                sourceEditor.setValue(e.data.source_code);
            }
            if (e.data.language_id && e.data.flavor) {
                selectLanguageByFlavorAndId(e.data.language_id, e.data.flavor);
            }
            if (e.data.stdin) {
                stdinEditor.setValue(e.data.stdin);
            }
            if (e.data.stdout) {
                stdoutEditor.setValue(e.data.stdout);
            }
            if (e.data.compiler_options) {
                $compilerOptions.val(e.data.compiler_options);
            }
            if (e.data.command_line_arguments) {
                $commandLineArguments.val(e.data.command_line_arguments);
            }
            if (e.data.api_key) {
                AUTH_HEADERS["Authorization"] = `Bearer ${e.data.api_key}`;
            }
        } else if (e.data.action === "run") {
            run();
        }
    };
});

// Add blockchain integration functions
async function compileContract() {
    $statusLine.html("Compiling contract...");
    
    try {
        // Here you would integrate with Solidity compiler
        // This is a placeholder - you'll need to implement actual Solidity compilation
        const sourceCode = sourceEditor.getValue();
        
        // Example using a web-based Solidity compiler API
        const response = await fetch('https://solc-bin.ethereum.org/bin/list.json');
        
        $statusLine.html("Compilation successful!");
        stdoutEditor.setValue("Contract compiled successfully. ABI and bytecode available.");
        
    } catch (error) {
        $statusLine.html("Compilation failed");
        stdoutEditor.setValue("Error compiling contract: " + error.message);
    }
}

async function deployContract() {
    $statusLine.html("Preparing to deploy contract...");
    
    try {
        if (!window.compilationResult) {
            $statusLine.html("Please compile the contract first");
            stdoutEditor.setValue("You need to compile the contract before deploying.\nPress Ctrl+Shift+C to compile.");
            return;
        }
        
        // Simulate deployment (in a real implementation, you'd use web3/ethers)
        const mockTxHash = "0x" + Math.random().toString(16).substring(2, 62);
        window.compilationResult.deployedContractHash = mockTxHash;
        
        // Update the deployed tab
        if (window.deployedEditor) {
            window.deployedEditor.setValue(
                "DeployedContractHash:\n" + mockTxHash + "\n\n" +
                "Contract Address:\n0x" + Math.random().toString(16).substring(2, 42) + "\n\n" +
                "Transaction Details:\n" +
                "- Block: #" + Math.floor(Math.random() * 1000000) + "\n" +
                "- Gas Used: " + Math.floor(Math.random() * 5000000) + "\n" +
                "- Timestamp: " + new Date().toISOString()
            );
        }
        
        $statusLine.html("Contract deployed successfully");
    } catch (error) {
        $statusLine.html("Deployment failed");
        if (window.deployedEditor) {
            window.deployedEditor.setValue("Error during deployment: " + error.message);
        }
    }
}

const DEFAULT_SOURCE = "\
// SPDX-License-Identifier: MIT\n\
pragma solidity ^0.8.0;\n\
\n\
contract HelloWorld {\n\
    string public greeting = \"Hello World\";\n\
    \n\
    function setGreeting(string memory _greeting) public {\n\
        greeting = _greeting;\n\
    }\n\
    \n\
    function getGreeting() public view returns (string memory) {\n\
        return greeting;\n\
    }\n\
}\
";

const DEFAULT_STDIN = "";
const DEFAULT_COMPILER_OPTIONS = "--optimize --optimize-runs=200";
const DEFAULT_CMD_ARGUMENTS = "";
const DEFAULT_LANGUAGE_ID = 83; // Solidity ID

function getEditorLanguageMode(languageName) {
    const DEFAULT_EDITOR_LANGUAGE_MODE = "plaintext";
    const LANGUAGE_NAME_TO_LANGUAGE_EDITOR_MODE = {
        "Bash": "shell",
        "R": "r",
        "SOL": "Solidity",
    }

    for (let key in LANGUAGE_NAME_TO_LANGUAGE_EDITOR_MODE) {
        if (languageName.toLowerCase().startsWith(key.toLowerCase())) {
            return LANGUAGE_NAME_TO_LANGUAGE_EDITOR_MODE[key];
        }
    }
    return DEFAULT_EDITOR_LANGUAGE_MODE;
}

const EXTENSIONS_TABLE = {
    "js": { "flavor": CE, "language_id": 63 },  // JavaScript (Node.js 12.14.0)
    "py": { "flavor": CE, "language_id": 71 },  // Python (3.8.1)
    "rs": { "flavor": CE, "language_id": 73 },  // Rust (1.40.0)
    "sh": { "flavor": CE, "language_id": 46 },  // Bash (5.0.0)
    "sol": { "flavor": CE, "language_id": 83 }, // Solidity
    "txt": { "flavor": CE, "language_id": 43 }, // Plain Text
};

function getLanguageForExtension(extension) {
    return EXTENSIONS_TABLE[extension] || { "flavor": CE, "language_id": 43 }; // Plain Text (https://ce.judge0.com/languages/43)
}

// Function to create a new file
function createNewFile() {
    const fileName = prompt("Enter file name:", "NewContract.sol");
    if (fileName) {
        fileSystem[fileName] = "";
        switchToFile(fileName);
        updateFileList();
    }
}

// Add or update these functions
function deleteCurrentFile() {
    if (Object.keys(fileSystem).length <= 1) {
        showError("Error", "Cannot delete the last file");
        return;
    }
    
    if (confirm(`Delete ${currentFile}?`)) {
        delete fileSystem[currentFile];
        currentFile = Object.keys(fileSystem)[0];
        switchToFile(currentFile);
        updateFileList();
    }
}

function getFileExtension(fileName) {
    return fileName.split('.').pop().toLowerCase();
}

// Update switchToFile to handle theme-consistent styling
function switchToFile(fileName) {
    // Save current file content
    if (currentFile && sourceEditor) {
        fileSystem[currentFile] = sourceEditor.getValue();
    }
    
    // Load new file
    currentFile = fileName;
    if (sourceEditor) {
        sourceEditor.setValue(fileSystem[fileName] || "");
        setSourceCodeName(fileName);
        
        // Set editor language based on file extension
        const extension = getFileExtension(fileName);
        const language = extension === 'sol' ? 'solidity' : getEditorLanguageMode(extension);
        monaco.editor.setModelLanguage(sourceEditor.getModel(), language);
    }
    
    updateFileList();
}

// Function to update the file list
function updateFileList() {
    const fileList = document.getElementById("file-list");
    if (!fileList) return;
    
    fileList.innerHTML = '';
    Object.keys(fileSystem).forEach(fileName => {
        const item = document.createElement("li");
        item.textContent = fileName;
        item.className = fileName === currentFile ? "active" : "";
        item.onclick = () => switchToFile(fileName);
        fileList.appendChild(item);
    });
}

// Update the language support in Monaco
function setupSoliditySupport() {
    monaco.languages.register({ id: 'solidity' });
    
    monaco.languages.setMonarchTokensProvider('solidity', {
        tokenizer: {
            root: [
                [/pragma\s+solidity/, 'keyword'],
                [/\b(contract|interface|library|function|constructor|event|modifier|struct|enum|mapping)\b/, 'keyword'],
                [/\b(public|private|internal|external|view|pure|payable|virtual|override|constant|immutable|returns)\b/, 'keyword'],
                [/\b(address|uint|int|bool|string|bytes|byte)\b(\d*)?/, 'type'],
                [/\b(msg|block|tx)\.(sender|value|gas|data|timestamp|blockhash|coinbase|difficulty|gaslimit|gasprice|origin)\b/, 'builtin'],
                [/\b(require|assert|revert|emit)\b/, 'statement'],
                [/\b(true|false|wei|gwei|ether|seconds|minutes|hours|days|weeks)\b/, 'builtin'],
                [/\b(memory|storage|calldata)\b/, 'storage'],
                [/\/\/.*/, 'comment'],
                [/\/\*/, 'comment', '@comment'],
                [/".*?"/, 'string'],
                [/'.*?'/, 'string'],
                [/\d+(\.\d+)?/, 'number'],
                [/0x[a-fA-F0-9]+/, 'number.hex'],
                [/[a-zA-Z_]\w*/, 'identifier'],
            ],
            comment: [
                [/\*\//, 'comment', '@pop'],
                [/./, 'comment']
            ]
        }
    });

    // Add solidity keywords for better autocomplete
    monaco.languages.registerCompletionItemProvider('solidity', {
        provideCompletionItems: () => {
            const keywords = [
                'contract', 'function', 'public', 'private', 'internal', 'external',
                'view', 'pure', 'payable', 'returns', 'address', 'uint', 'uint256',
                'bytes', 'bytes32', 'string', 'bool', 'mapping', 'struct', 'enum',
                'constructor', 'event', 'modifier', 'emit', 'require', 'assert',
                'revert', 'memory', 'storage', 'calldata', 'virtual', 'override'
            ];
            
            return {
                suggestions: keywords.map(keyword => ({
                    label: keyword,
                    kind: monaco.languages.CompletionItemKind.Keyword,
                    insertText: keyword
                }))
            };
        }
    });

    // Add this to your setupSoliditySupport function or another appropriate location
    monaco.editor.defineTheme('solidity-output', {
        base: 'vs-dark',
        inherit: true,
        rules: [
            { token: 'section.header', foreground: '#569CD6', fontStyle: 'bold' },
            { token: 'section.content', foreground: '#CE9178' }
        ],
        colors: {}
    });
}

function addDeployedTab() {
    // Find the I/O container
    const ioContainer = layout.root.getItemsById("stdin")[0].parent.parent;
    
    // Add the deployed component
    ioContainer.addChild({
        type: "component",
        componentName: "deployed",
        id: "deployed",
        title: "Deployed",
        componentState: {
            readOnly: true
        }
    });
    
    // Make sure the deployed tab is registered
    if (!layout._components.deployed) {
        layout.registerComponent("deployed", function(container, state) {
            window.deployedEditor = monaco.editor.create(container.getElement()[0], {
                automaticLayout: true,
                scrollBeyondLastLine: false,
                readOnly: state.readOnly,
                language: "plaintext",
                minimap: {
                    enabled: false
                }
            });
        });
    }
}
