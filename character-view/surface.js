import * as T from "three";

// Editable cross sections follow a centreline. Parallel-transported frames
// keep fins slender and limbs round even as the spine bends around a corner.
export function sweepGeometry(knots) {
  const centers=knots.map(([x,y,z])=>new T.Vector3(x,y,z));
  const path=new T.CatmullRomCurve3(centers,false,"centripetal");
  const bands=(knots.length-1)*5, sides=20;
  const points=[], uv=[], indices=[];
  let lastAxis;
  for(let row=0;row<=bands;row++){
    const t=row/bands,center=path.getPoint(t),along=path.getTangent(t).normalize();
    if(!lastAxis)lastAxis=Math.abs(along.x)<.85?new T.Vector3(1,0,0):new T.Vector3(0,0,1);
    const u=lastAxis.clone().addScaledVector(along,-lastAxis.dot(along)).normalize();
    const v=new T.Vector3().crossVectors(along,u).normalize();
    lastAxis=u;
    const at=t*(knots.length-1),left=Math.min(knots.length-2,Math.floor(at)),mix=at-left;
    const w=T.MathUtils.lerp(knots[left][3],knots[left+1][3],mix);
    const d=T.MathUtils.lerp(knots[left][4],knots[left+1][4],mix);
    for(let k=0;k<=sides;k++){
      const phi=(k/sides)*Math.PI*2;
      const pt=center.clone().addScaledVector(u,w*Math.cos(phi)).addScaledVector(v,d*Math.sin(phi));
      points.push(pt.x,pt.y,pt.z);uv.push(k/sides,t);
      if(row<bands && k<sides){
        const a=row*(sides+1)+k,b=a+sides+1;
        indices.push(a,a+1,b,a+1,b+1,b);
      }
    }
  }
  for(let k=1;k<sides-1;k++){
    indices.push(0,k+1,k);
    const end=bands*(sides+1);
    indices.push(end,end+k,end+k+1);
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute("position",new T.Float32BufferAttribute(points,3));
  geometry.setAttribute("uv",new T.Float32BufferAttribute(uv,2));geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Average duplicate normals at the longitude seam.
  const normals=geometry.getAttribute("normal");
  for(let row=0;row<=bands;row++){
    const a=row*(sides+1),b=a+sides;
    const normal=new T.Vector3().fromBufferAttribute(normals,a).add(new T.Vector3().fromBufferAttribute(normals,b)).normalize();
    normals.setXYZ(a,normal.x,normal.y,normal.z);normals.setXYZ(b,normal.x,normal.y,normal.z);
  }
  return geometry;
}
