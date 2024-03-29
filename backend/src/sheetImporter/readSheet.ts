import {Workbook, Worksheet, Cell, ValueType} from "exceljs";
import testLayout from "./sheetLayouts/testLayout";
import testDataLayout from "./sheetLayouts/testDataLayout";
import Test from "../interfaces/Test/test";
import { ObjectId } from "mongodb";
import Question from "../interfaces/Test/question";
import QuestionDomain, { stringToQuestionDomain } from "../enums/Test/questionDomain";
import QuestionDimension, { letterToQuestionDimension } from "../enums/Test/questionDimension";
import QuestionType, { letterToQuestionType } from "../enums/Test/questionType";
import TestsDao from "../dao/testsDAO";
import QuestionsDao from "../dao/questionsDAO";
import QuestionAnswer from "../interfaces/Test/questionAnswer";
import QuestionAnswersDao from "../dao/questionAnswersDAO";
import log from "../logger";
import LogLevel from "../enums/logLevel";

export async function importSpreadsheet() {
    let {tests, questions, questionAnswers} = await readSheet();

    log(LogLevel.Debug, "Importing spreadsheet");
    for (let i = 0; i < tests.length; i++) {

        const oldTest = await TestsDao.getTestByName(tests[i].name);
        // check if test already exists
        if (oldTest) {
            log(LogLevel.Debug, `Test ${tests[i].name} already exists, updating test`);
            // test already exists, update all questions to use the original ID
            for (let j = 0; j < questions.length; j++) {
                if (questions[j].test == tests[i]._id) {
                    questions[j].test = oldTest._id;
                }
            }
            // update all question answers to use the original ID
            for (let j = 0; j < questionAnswers.length; j++) { 
                if (questionAnswers[j].test == tests[i]._id) {
                    questionAnswers[j].test = oldTest._id;
                }
            }

            // change the test object's ID to the original test's ID
            tests[i]._id = oldTest._id;
            // if something changed, update the test in the database
            if (tests[i] !== oldTest) {
                TestsDao.updateTestById(oldTest._id, tests[i]);
            }
        }
        else {
            const newId = await TestsDao.insertTest(tests[i]);
            if (!newId) {
                throw new Error(`Toets ${tests[i].name} kon niet worden geimporteerd! (database gaf een error tijdens insert toets)`);
            }
            tests[i]._id = newId;
        }
        // delete all question answers because people might've been added/removed and might've changed their version
        QuestionAnswersDao.deleteQuestionAnswersByTestId(tests[i]._id);
    }

    for (let i = 0; i < questions.length; i++) {
        let oldQuestion = await QuestionsDao.getQuestionByTestIdAndQuestionNumber(questions[i].test, questions[i].questionNumber);
        // check if question already exists
        if (oldQuestion) {
            // questions already exists, update the question to use the original ID
            questions[i]._id = oldQuestion._id;
            // if something changed, update the question
            if (questions[i] !== oldQuestion) {
                QuestionsDao.updateQuestionById(oldQuestion._id, questions[i]);
            }
        } else {
            const newId = await QuestionsDao.insertQuestion(questions[i]);
            if (!newId) {
                throw new Error(`Vraag ${questions[i].questionNumber} van toets ${questions[i].testName} kon niet worden geimporteerd! (database gaf een error tijdens insert vraag)`);
            }
            questions[i]._id = newId;
        }
    }



    

    for (let i = 0; i < questionAnswers.length; i++) {
        let oldQuestionAnswer = await QuestionAnswersDao.getQuestionAnswerByTestIdAndQuestionNumberAndEmailAndVersion(questionAnswers[i].test, questionAnswers[i].questionNumber, questionAnswers[i].email.toLowerCase(), questionAnswers[i].version);
        // check if question already exists
        if (oldQuestionAnswer) {
            // question answer already exists, update the question to use the original ID
            questionAnswers[i]._id = oldQuestionAnswer._id;
            // if something changed, update the question
            if (questionAnswers[i] !== oldQuestionAnswer) {
                QuestionAnswersDao.updateQuestionAnswerById(oldQuestionAnswer._id, questionAnswers[i]);
            }
        } else {
            const newId = await QuestionAnswersDao.insertQuestionAnswer(questionAnswers[i]);
            if (!newId) {
                throw new Error(`Antwoord van vraag ${questionAnswers[i].questionNumber} van toets ${questionAnswers[i].testName} van leerling met email ${questionAnswers[i].email.toLowerCase()} kon niet worden geimporteerd! (database gaf een error tijdens insert antwoord)`);
            }
            questionAnswers[i]._id = newId;
        
        }
    }
    


}






async function readSheet(): Promise<{tests: Test[], questions: Question[], questionAnswers: QuestionAnswer[]}> {
    const workbook = new Workbook();
    await workbook.xlsx.readFile("./uploads/importSpreadsheet.xlsx");
    const sheet = workbook.getWorksheet(testDataLayout.sheetName);

    let tests: Test[] = [];
    let questions: Question[] = [];
    let questionAnswers: QuestionAnswer[] = [];

    if (sheet) {
        for (let startRow = 0; startRow < 10000; startRow += 5) {
            const sheetCodeCell = sheet.getCell(testDataLayout.sheetCodeRowIndex + startRow, testDataLayout.sheetCodeColumn);
            if (sheetCodeCell.type == ValueType.Null) {
                break;
            }
            const result = readTestData(sheet, startRow);
            tests.push(result.test);
            questions.push(...result.questions);
        }
    } else {
        throw new Error(`Blad ${testDataLayout.sheetName} niet gevonden!`);
    }

    // loops through all tests (i)
    for (let i = 0; i < tests.length; i++) {
        const sheetCode = tests[i].sheetCode;
        const sheet = getSheetFromSheetCode(workbook, sheetCode);
        const totalQuestions = tests[i].totalQuestions;
        
        // loops through all students (j) per test sheet (i)
        for (let j = 0; j < 1000; j++) {
            const emailCell = sheet.getCell(testLayout.firstStudentRow + j, testLayout.emailColumn);
            let email: string;
            try {
                email = getCellValueAsString(emailCell).toLowerCase();
            } catch (e) {
                break;
            }

            const versionCell = sheet.getCell(testLayout.firstStudentRow + j, testLayout.versionColumn);
            const version = getCellValueAsString(versionCell, new Error(`Versie op (rij: ${testLayout.firstStudentRow + j} column ${testLayout.versionColumn}) op blad ${sheet.name} met bladcode ${sheetCode} voor leerling met email ${email} is geen string!`));
            // check if version matches, if not then continue to the next student, this student will get taken care of by the other iteration(s) of the tests
            if (version !== tests[i].version) {
                continue;
            }

            // loops through all points per question (k) per student (j) per test sheet (i)
            for (let k = 0; k < 1000; k++) {
                const questionPointsCell = sheet.getCell(testLayout.firstStudentRow + j, testLayout.firstQuestionColumn + k);
                
                let points: number;
                try {
                    points = getCellValueAsNumber(questionPointsCell);
                } catch (e) {
                    break;
                }
                
                const questionAnswer: QuestionAnswer = {
                    _id: new ObjectId(),
                    test: tests[i]._id,
                    questionNumber: k + 1,
                    email: email,
                    points: points,
                    testName: tests[i].name,
                    version: tests[i].version
                }

                questionAnswers.push(questionAnswer);
            }
        }
    }

    return {tests: tests, questions: questions, questionAnswers: questionAnswers};
}



function getSheetFromSheetCode(workbook: Workbook, sheetCode: String): Worksheet {

    for (let i = 0; i < workbook.worksheets.length; i++) {
        const sheet = workbook.worksheets[i];
        const sheetCodeCell = sheet.getCell(testLayout.sheetCodeRow, testLayout.sheetCodeColumn);
        let sheetCodeString: string;
        try {
            sheetCodeString = getCellValueAsString(sheetCodeCell);
        } catch (e) {
            continue;
        }

        if (sheetCodeString === sheetCode) {
            return sheet;
        }
    }

    throw new Error(`Blad met bladcode ${sheetCode} niet gevonden!`);
}


function readTestData(sheet: Worksheet, startRow: number): {test: Test; questions: Question[]} {

    const totalPointsCell = sheet.getCell(testDataLayout.totalPointsRowIndex + startRow, testDataLayout.totalPointsColumn);

    const totalPoints = getCellValueAsNumber(totalPointsCell, new Error(`Totaal punten op rij ${testDataLayout.totalPointsRowIndex + startRow} in ${testDataLayout.sheetName} is geen nummer! (rij nr: ${testDataLayout.totalPointsRowIndex + startRow}, col nr: ${testDataLayout.totalPointsColumn})`));

    const sheetCodeCell = sheet.getCell(testDataLayout.sheetCodeRowIndex + startRow, testDataLayout.sheetCodeColumn);
    const sheetCode = getCellValueAsString(sheetCodeCell, new Error(`Bladcode op rij ${testDataLayout.sheetCodeRowIndex + startRow} in ${testDataLayout.sheetName} is geen string! (rij nr: ${testDataLayout.sheetCodeRowIndex + startRow}, col nr: ${testDataLayout.sheetCodeColumn})`));

    const testNameCell = sheet.getCell(testDataLayout.testNameRowIndex + startRow, testDataLayout.testNameColumn);
    const testName = getCellValueAsString(testNameCell, new Error(`Testnaam op rij ${testDataLayout.testNameRowIndex + startRow} in ${testDataLayout.sheetName} is geen string! (rij nr: ${testDataLayout.testNameRowIndex + startRow}, col nr: ${testDataLayout.testNameColumn})`));

    const versionCell = sheet.getCell(testDataLayout.testVersionRowIndex + startRow, testDataLayout.testVersionColumn);
    let version: string;
    if (versionCell.type == ValueType.String || versionCell.type == ValueType.Number) {
        version = `${versionCell.value}`;

    } else if (versionCell.type == ValueType.Formula) {
        version = `${versionCell.result}`;
    } else {
        throw new Error(`Versie op rij ${testDataLayout.testVersionRowIndex + startRow} in ${testDataLayout.sheetName} is geen string of nummer! (rij nr: ${testDataLayout.testVersionRowIndex + startRow}, col nr: ${testDataLayout.testVersionColumn})`);

    }

    const totalQuestionsCell = sheet.getCell(testDataLayout.totalQuestionsRowIndex + startRow, testDataLayout.totalQuestionsColumn);
    const totalQuestions = getCellValueAsNumber(totalQuestionsCell, new Error(`Totaal vragen op rij ${testDataLayout.totalQuestionsRowIndex + startRow} in ${testDataLayout.sheetName} is geen nummer! (rij nr: ${testDataLayout.totalQuestionsRowIndex + startRow}, col nr: ${testDataLayout.totalQuestionsColumn})`));

    let testData: Test = {
        _id: new ObjectId(),
        name: testName,
        sheetCode: sheetCode,
        totalPoints: totalPoints,
        version: version,
        totalQuestions: totalQuestions
    }


    let questions: Question[] = [];
    for (let i = 0; i < totalQuestions; i++) {
        let currentColumn = testDataLayout.firstQuestionColumn + i;


        let questionNumberCell = sheet.getCell(testDataLayout.questionNumberRowIndex + startRow, currentColumn);
        const questionNumber = getCellValueAsNumber(questionNumberCell, new Error(`Vraagnummer op rij ${testDataLayout.questionNumberRowIndex + startRow} in ${testDataLayout.sheetName} is geen nummer! (rij nr: ${testDataLayout.questionNumberRowIndex + startRow}, col nr: ${currentColumn})`));

        let questionPointsCell = sheet.getCell(testDataLayout.questionPointsRowIndex + startRow, currentColumn);
        const questionPoints = getCellValueAsNumber(questionPointsCell, new Error(`Vraagpunten op rij ${testDataLayout.questionPointsRowIndex + startRow} in ${testDataLayout.sheetName} is geen nummer! (rij nr: ${testDataLayout.questionPointsRowIndex + startRow}, col nr: ${currentColumn})`));

        let questionDimensionCell = sheet.getCell(testDataLayout.questionDimensionRowIndex + startRow, currentColumn);
        const questionDimension = getCellValueAsString(questionDimensionCell, new Error(`Vraagdimensie op rij ${testDataLayout.questionDimensionRowIndex + startRow} in ${testDataLayout.sheetName} is geen string! (rij nr: ${testDataLayout.questionDimensionRowIndex + startRow}, col nr: ${currentColumn})`));

        let questionTypeCell = sheet.getCell(testDataLayout.questionTypeRowIndex + startRow, currentColumn);
        const questionTypeString = getCellValueAsString(questionTypeCell, new Error(`Vraagtype op rij ${testDataLayout.questionTypeRowIndex + startRow} in ${testDataLayout.sheetName} is geen string! (rij nr: ${testDataLayout.questionTypeRowIndex + startRow}, col nr: ${currentColumn})`));

        let questionDomainCell = sheet.getCell(testDataLayout.questionDomainRowIndex + startRow, currentColumn);
        const questionDomainString = getCellValueAsString(questionDomainCell, new Error(`Vraagdomein op rij ${testDataLayout.questionDomainRowIndex + startRow} in ${testDataLayout.sheetName} is geen string! (rij nr: ${testDataLayout.questionDomainRowIndex + startRow}, col nr: ${currentColumn})`));


        let domain: QuestionDomain;
        try {
            domain = stringToQuestionDomain(questionDomainString);
        } catch (e) {
            throw new Error(`Vraagdomein op rij ${testDataLayout.questionDomainRowIndex + startRow} in ${testDataLayout.sheetName} is geen geldig vraagdomein! (rij nr: ${testDataLayout.questionDomainRowIndex + startRow}, col nr: ${currentColumn})`);
        }

        let dimension: QuestionDimension;
        try {
            dimension = letterToQuestionDimension(questionDimension);
        } catch (e) {
            throw new Error(`Vraagdimensie op rij ${testDataLayout.questionDimensionRowIndex + startRow} in ${testDataLayout.sheetName} is geen geldige vraagdimensie! (rij nr: ${testDataLayout.questionDimensionRowIndex + startRow}, col nr: ${currentColumn})`);
        }

        let questionType: QuestionType;
        try {
            questionType = letterToQuestionType(questionTypeString);
        } catch (e) {
            throw new Error(`Vraagtype op rij ${testDataLayout.questionTypeRowIndex + startRow} in ${testDataLayout.sheetName} is geen geldig vraagtype! (rij nr: ${testDataLayout.questionTypeRowIndex + startRow}, col nr: ${currentColumn})`);
        }


        let question: Question = {
            _id: new ObjectId(),
            test: testData._id,
            questionNumber: questionNumber,
            points: questionPoints,
            dimension: dimension,
            questionType: questionType,
            domain: domain,
            testName: testData.name
        }

        questions.push(question);
    }

    return {test: testData, questions: questions};
}


function getCellValueAsNumber(cell: Cell, errorIfInvalidType?: Error): number {
    if (cell.type == ValueType.Number) {
        return cell.value as number;
    } else if (cell.type == ValueType.Formula) {
        return cell.result as number;
    } else {
        if (errorIfInvalidType) {
            throw errorIfInvalidType;
        } else {
            throw new Error(`Cell (row: ${cell.row} col: ${cell.col}) is not a number!`);
        }
    }
}


function getCellValueAsString(cell: Cell, errorIfInvalidType?: Error): string {
    if (cell.type == ValueType.String) {
        return cell.value as string;
    } else if (cell.type == ValueType.Formula) {
        return cell.result as string;
    } else if (cell.type == ValueType.Number) {
        return `${cell.value}`;
    } else {
        if (errorIfInvalidType) {
            throw errorIfInvalidType;
        } else {
            throw new Error(`Cell (row: ${cell.row} col: ${cell.col}) is not a string!`);
        }
    }
}