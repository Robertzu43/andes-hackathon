"""Independent synthetic PR46 controls for review5560885028; no candidate writes."""
import contextlib
import csv
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

candidate, output = map(lambda p: Path(p).resolve(), sys.argv[1:])
output.mkdir()
spec = importlib.util.spec_from_file_location('reviewed_incident_kit', candidate/'evidence/incident_kit.py')
kit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kit)
results = []

def read(folder, table):
    with (folder/(table+'.csv')).open(newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        return reader.fieldnames, list(reader)

def save(folder, table, columns, rows):
    with (folder/(table+'.csv')).open('w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)

def edit(folder, table, key, **changes):
    columns, rows = read(folder, table)
    row = next(r for r in rows if r[columns[0]] == key)
    row.update(changes)
    save(folder, table, columns, rows)

def new_source(folder):
    columns, rows = read(folder, 'sources')
    row = dict(rows[0])
    row.update(source_id='SYN-A-W-S9', case_id='SYN-A-W', kind='independent_record',
               provided_by='SYN-A-D', evidence_basis='independent_observation',
               timestamped_record='no', source_time_zone='')
    rows.append(row)
    save(folder, 'sources', columns, rows)

def rest_event(folder, account=''):
    new_source(folder)
    edit(folder, 'timeline', 'SYN-A-W-E03', event_type='rest_start', occurrence='corroborated',
         source_ids='SYN-A-W-S9'+(';' + account if account else ''),
         basis_source_id='SYN-A-W-S9', basis_note='SYNTHETIC independent tracker stop',
         time_basis='unknown', observed_time='', observed_source_id='')

def run(name, action):
    record = {'case': name}
    with tempfile.TemporaryDirectory(prefix='q60-pr46-') as temporary:
        folder=Path(temporary)/'cohort'
        shutil.copytree(candidate/'evidence/fixtures/synthetic', folder)
        try:
            action(folder, record)
            record['passed'] = True
        except (AssertionError, TypeError, KeyError) as error:
            record['passed'] = False
            record['assertion'] = str(error)
    results.append(record)

def export(folder, record):
    payload, report=kit.export(folder)
    record.update(errors=report.errors, warnings=report.warnings)
    return payload, report

def duplicate(table, whitespace=False):
    def action(folder, record):
        if table=='participants': edit(folder, table, 'SYN-B-C', consent_share_redacted='no')
        path=folder/(table+'.csv')
        rows=list(csv.reader(io.StringIO(path.read_text(encoding='utf-8'))))
        key='consent_share_redacted' if table=='participants' else rows[0][0]
        rows[0].append(' '+key+' ' if whitespace else key)
        for row in rows[1:]: row.append('yes' if table=='participants' else row[0])
        with path.open('w',newline='',encoding='utf-8') as f: csv.writer(f).writerows(rows)
        payload,report=export(folder,record)
        assert payload is None and any('duplicate column' in e for e in report.errors)
    return action

for table in ['participants','cases','sources','timeline']:
    run('duplicate-'+table, duplicate(table))
run('duplicate-consent-whitespace', duplicate('participants', True))

def exclusion(folder, record):
    edit(folder,'participants','SYN-B-C',consent_share_redacted='no')
    target=folder/'out.json'
    p=subprocess.run([sys.executable,'-I','-B',str(candidate/'evidence/incident_kit.py'),
                      'export',str(folder),'--out',str(target)],capture_output=True,text=True)
    record.update(exit=p.returncode,stdout=p.stdout,stderr=p.stderr)
    assert p.returncode==0
    text=target.read_text(encoding='utf-8');payload=json.loads(text)
    for private in ['SYN-B','SYN-A-O','consent_share_redacted','redaction_status']:
        assert private not in text+p.stdout+p.stderr, private+' leaked'
    assert payload['excluded_cases']['count']==2
    assert payload['excluded_cases']['by_reason']['consent']==1
run('aggregate-exclusions-json-and-cli',exclusion)

def review_state(column,state):
    def action(folder,record):
        edit(folder,'cases','SYN-A-W',driver_review='confirmed',contact_review='corrected',trace_review='traced')
        edit(folder,'cases','SYN-A-W',**{column:state})
        payload,report=export(folder,record)
        assert payload is not None and not report.errors
        assert 'SYN-A-W' not in [c['case_id'] for c in payload['cases']]
    return action
for column,states in [('driver_review',['pending','declined','disputed']),
                      ('contact_review',['pending','declined','disputed']),
                      ('trace_review',['pending','not_traceable','inconclusive'])]:
    for state in states:run(column+'-'+state,review_state(column,state))

def review_positive(folder,record):
    edit(folder,'cases','SYN-A-W',driver_review='corrected',contact_review='confirmed',trace_review='traced')
    payload,report=export(folder,record)
    assert payload is not None and not report.errors and 'SYN-A-W' in [c['case_id'] for c in payload['cases']]
run('completed-reviews-positive',review_positive)

def rest(account, rejected=False, warning=False):
    def action(folder,record):
        rest_event(folder,account)
        payload,report=export(folder,record)
        if rejected: assert payload is None and any('participant account' in e for e in report.errors)
        else:
            assert payload is not None and not report.errors
            if warning:
                assert any('SYN-A-W-E03' in w and 'message authorship' in w for w in report.warnings), 'corroborated message account has no authorship warning'
    return action
run('tracker-alone-is-not-rest',rest('',rejected=True))
run('tracker-plus-own-account-positive',rest('SYN-A-W-S1'))
run('corroborated-message-authorship-warning',rest('SYN-A-W-S3',warning=True))

def no_zones(table,key,column,value,rejected=True):
    def action(folder,record):
        edit(folder,table,key,**{column:value})
        previous=kit.ZONES
        try:
            kit.ZONES=set()
            payload,report=export(folder,record)
        finally: kit.ZONES=previous
        if rejected:
            assert payload is None and any(column in e for e in report.errors)
            assert value not in '\n'.join(report.errors)
        else: assert payload is not None and not report.errors and any('no time-zone database' in w for w in report.warnings)
    return action
for table,key,column in [('timeline','SYN-A-W-E02','time_zone'),('sources','SYN-A-W-S3','source_time_zone')]:
    for i,value in enumerate(['MARIA-SILVA','MARIA SILVA +55 00 00000-0000','person@example.com']):
        run('zone-'+table+'-'+str(i),no_zones(table,key,column,value))
    run('zone-'+table+'-positive',no_zones(table,key,column,'America/Sao_Paulo',False))

def missing(folder,record):
    edit(folder,'timeline','SYN-A-W-E02',source_ids='MARIA-SILVA')
    payload,report=export(folder,record)
    assert payload is None and any('not in sources.csv' in e for e in report.errors)
    assert 'MARIA-SILVA' not in '\n'.join(report.errors+report.warnings)
run('missing-source-value-private',missing)

for value in ['300 km de serra','1500 kg','tank at 1/2','open 24/7','stopped.Then']:
    def action(folder,record,value=value):
        edit(folder,'timeline','SYN-A-W-E02',note_redacted=value)
        payload,report=export(folder,record)
        assert payload is not None and not report.errors
    run('ordinary-'+value,action)

for value in ['SYN-1234','CAS-0001']:
    def action(folder,record,value=value): assert kit._id(value) is None
    run('reserved-'+value,action)

for i,value in enumerate(['14-09-26','14.09','14 setembro','14 septiembre','23°33′S 46°38′W']):
    def action(folder,record,value=value):
        edit(folder,'timeline','SYN-A-W-E02',note_redacted=value)
        payload,report=export(folder,record)
        assert payload is None and any('note_redacted seems to contain' in e for e in report.errors)
    run('short-date-coordinate-'+str(i),action)

def independent_errors(folder,record):
    edit(folder,'participants','SYN-B-C',preferred_language='bad!')
    edit(folder,'timeline','SYN-A-W-E03',source_ids='SYN-A-W-S2',time_basis='unknown',observed_time='',observed_source_id='')
    payload,report=export(folder,record)
    assert payload is None
    assert any('preferred_language' in e for e in report.errors)
    assert any("self_reported needs the participant's own" in e for e in report.errors)
run('cell-error-preserves-other-provenance-diagnostic',independent_errors)

summary={'runtime':sys.version,'candidate':str(candidate),'total':len(results),
         'passed':sum(r['passed'] for r in results),'failed':[r['case'] for r in results if not r['passed']],
         'results':results}
(output/'results.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k!='results'}))
sys.exit(bool(summary['failed']))
