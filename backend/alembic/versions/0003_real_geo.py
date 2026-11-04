"""Locality boundaries as MultiPolygon + boundary source (for importing real ward maps)

Revision ID: 0003_real_geo
Revises: 0002_email
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_real_geo"
down_revision = "0002_email"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE localities ALTER COLUMN boundary TYPE geography(MULTIPOLYGON, 4326) "
               "USING ST_Multi(boundary::geometry)::geography")
    op.add_column("localities", sa.Column("boundary_source", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("localities", "boundary_source")
    op.execute("ALTER TABLE localities ALTER COLUMN boundary TYPE geography(POLYGON, 4326) "
               "USING ST_GeometryN(boundary::geometry, 1)::geography")
