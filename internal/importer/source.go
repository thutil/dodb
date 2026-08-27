package importer

// BatchItem is one statement handed to the executor.
type BatchItem struct {
	SQL string
	// Rows is how many SOURCE rows the statement carries, so a 500-row INSERT
	// reports 500 rows imported rather than one statement run.
	Rows uint64
	// Line is the source line, when the format has one.
	Line *uint64
	// Index is a 1-based sequence number, used to point the user at a failure.
	Index uint64
}

// BatchSource feeds the executor without ever holding the whole file in memory.
type BatchSource interface {
	// NextBatch returns the next batch, or nil at end of input.
	NextBatch() ([]BatchItem, error)
	BytesRead() uint64
	TotalBytes() uint64
	// TakeFailures drains rows the source itself rejected. A value that could
	// not be coerced never becomes SQL, so the executor would never see it --
	// without this they would vanish from the report.
	TakeFailures() []Failure
	// TablesTouched lists the tables the source wrote to.
	TablesTouched() []string
	// Stats reports counters the source accumulated.
	Stats() SourceStats
	Close() error
}

// SourceStats are the counters a source accumulates while reading.
type SourceStats struct {
	SkippedVersionComments uint64
	SkippedMetaCommands    uint64
	CopyRows               uint64
}
