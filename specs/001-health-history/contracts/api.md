# API Contract

All endpoints under /api. JSON errors use {detail: string}. Frontend must show errors.

- GET /health -> {status, explanation_mode, version}
- GET /patients -> {patients: Patient[]}
- GET /patients/{id}/records -> {patient: Patient, records: Observation[]}
- POST /upload multipart file -> {patients: Patient[], message}; 2 MB/10,000 rows limits.
- POST /analyze/{patient_id} -> {analysis_id}; background execution, no simulated progress.
- GET /analysis/{id} -> Analysis (poll every 500 ms while pending/running)
- GET /analysis/{id}/trends -> {trends: Trend[]}
- GET /analysis/{id}/evidence -> {evidence: Evidence[]}
- POST /chat {analysis_id,question,previous_measurements?:string[]} -> ChatResponse
- DELETE /data -> {message}; deletes local uploaded records and analyses, retains seeds.
- GET /sample.csv -> CSV example.

Patient = {id,source,source_url?:string,years:number[],observation_count:number}
Observation = {id,patient_id,date,measurement,value:number,unit,reference_range?:string,source}
Trend = {measurement,unit,observations:Observation[],first_value,latest_value,
 absolute_change,percentage_change:number|null,direction,consistency,
 changes:{from_date,to_date,absolute_change,percentage_change:number|null,year_over_year:boolean}[],
 verified:boolean,evidence_id:string}
Evidence = {id,measurement,claim,verified,observations:Observation[],calculation:string,
 verification_notes:string[]}
Analysis = {id,patient_id,status,created_at,stages:AgentStage[],summary,
 explanation_mode,years:number[],stats:{years_analyzed,measurements_compared,changes_identified,
 findings_verified},trends:Trend[],evidence:Evidence[],warnings:string[],error?:string}
AgentStage = {name,status,started_at?:string,completed_at?:string,detail:string}
ChatResponse = {answer,evidence:Evidence[],agents_used:string[],explanation_mode,
 measurements:string[]}

Empty analysis arrays exist during pending state; failed analysis has error. Unknown IDs return
404. Invalid data/questions return 422; file too large 413. Incomplete analysis chat returns 409.
All computations return finite numbers or null; JSON never contains NaN/Infinity.
