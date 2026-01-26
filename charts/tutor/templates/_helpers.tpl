{{- define "tutor.name" -}}
{{ .Values.app.name }}
{{- end }}

{{- define "tutor.namespace" -}}
dev-{{ .Values.app.team }}-{{ .Values.app.name }}
{{- end }}

{{- define "tutor.labels" -}}
app.kubernetes.io/name: {{ include "tutor.name" . }}
app.kubernetes.io/team: {{ .Values.app.team }}
app.kubernetes.io/managed-by: platform
{{- end }}

{{- define "tutor.selectorLabels" -}}
app.kubernetes.io/name: {{ include "tutor.name" . }}
app.kubernetes.io/team: {{ .Values.app.team }}
{{- end }}
